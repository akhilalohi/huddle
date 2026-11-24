/**
 * The deal engine: settles deals when their timer ends (or they sell out).
 *
 *  - threshold met  -> capture every card hold at the FINAL tier price, create
 *                      one Order per participant, deal = "succeeded"
 *  - threshold not met -> release every hold (nobody is charged), deal = "failed"
 *
 * Safe to call repeatedly and from several places: the first thing closeDeal
 * does is atomically flip the deal from "open" to "closing". Only one caller
 * can win that update, so a deal is never settled twice.
 */
const Deal = require("../models/Deal");
const Pledge = require("../models/Pledge");
const Order = require("../models/Order");
const Product = require("../models/Product");
const pricing = require("./pricing");
const payment = require("./payment");

async function closeDeal(dealId) {
  // Atomic lock: only one caller can move open -> closing.
  const deal = await Deal.findOneAndUpdate(
    { _id: dealId, status: "open" },
    { $set: { status: "closing" } },
    { new: true }
  );
  if (!deal) return null; // already closed (or being closed) by someone else

  const product = await Product.findById(deal.product);
  const pledges = await Pledge.find({ deal: deal._id, status: "authorized" });
  const count = pledges.length;

  try {
    if (pricing.thresholdMet(deal.tiers, count)) {
      const unit = pricing.priceAt(product.price, deal.tiers, count);

      for (const pledge of pledges) {
        const total = unit * pledge.qty;
        const paid = await payment.capture(pledge.authRef, total);
        const order = await Order.create({
          user: pledge.user,
          source: "group-deal",
          deal: deal._id,
          items: [
            {
              product: product._id,
              title: product.title,
              productCode: product.productCode,
              imagePath: product.imagePath,
              qty: pledge.qty,
              unitPrice: unit,
              listPrice: product.price,
            },
          ],
          totalQty: pledge.qty,
          totalCost: total,
          totalSaved: (product.price - unit) * pledge.qty,
          address: pledge.address,
          paymentRef: paid.ref,
          cardLast4: pledge.cardLast4,
        });
        pledge.status = "captured";
        pledge.finalAmount = total;
        pledge.order = order._id;
        await pledge.save();
      }
      deal.status = "succeeded";
      deal.finalPrice = unit;
      deal.finalParticipants = count;
    } else {
      for (const pledge of pledges) {
        await payment.release(pledge.authRef);
        pledge.status = "released";
        await pledge.save();
      }
      deal.status = "failed";
      deal.finalParticipants = count;
    }
    await deal.save();
  } catch (err) {
    // Something broke half-way: reopen the deal so the next tick can retry the
    // pledges that are still "authorized" (captured ones are skipped above).
    console.error(`Deal ${deal._id} could not be settled, will retry:`, err.message);
    await Deal.updateOne({ _id: deal._id }, { $set: { status: "open" } });
    throw err;
  }
  return deal;
}

/** Settle every open deal whose timer has run out. Returns how many were closed. */
async function closeExpiredDeals(now = new Date()) {
  const due = await Deal.find({ status: "open", endsAt: { $lte: now } }).select("_id");
  let closed = 0;
  for (const d of due) {
    try {
      if (await closeDeal(d._id)) closed++;
    } catch (_) {
      /* logged inside closeDeal; keep going with the other deals */
    }
  }
  return closed;
}

function startScheduler(intervalMs) {
  const timer = setInterval(() => {
    closeExpiredDeals().catch((e) => console.error("Deal check failed:", e.message));
  }, intervalMs);
  timer.unref();
  return timer;
}

/** An error whose message is safe and useful to show to the shopper. */
class DealError extends Error {}

/**
 * Join a deal: reserve a slot atomically, hold the card at the full list price,
 * record the pledge. Any failure undoes whatever was done before it.
 */
async function joinDeal(dealId, userId, { qty, address, cardNumber }) {
  const now = new Date();
  const deal = await Deal.findById(dealId).populate("product");
  if (!deal) throw new DealError("Deal not found");
  if (deal.status !== "open" || deal.endsAt <= now) throw new DealError("This deal has ended");
  if (!deal.product || !deal.product.available) throw new DealError("This product is currently unavailable");
  if (!Number.isInteger(qty) || qty < 1 || qty > deal.maxQtyPerPerson) {
    throw new DealError(`You can pledge for 1 to ${deal.maxQtyPerPerson} units`);
  }
  if (await Pledge.exists({ deal: deal._id, user: userId })) {
    throw new DealError("You have already joined this deal");
  }

  // Atomic slot reservation: the filter itself enforces "open, not expired,
  // not full", so two people racing for the last slot cannot both get it.
  // (maxParticipants never changes after a deal is created, so the value read
  // above is safe to use in the filter.)
  const slotFilter = { _id: deal._id, status: "open", endsAt: { $gt: now } };
  if (deal.maxParticipants > 0) slotFilter.participantCount = { $lt: deal.maxParticipants };
  const reserved = await Deal.findOneAndUpdate(
    slotFilter,
    { $inc: { participantCount: 1 } },
    { new: true }
  );
  if (!reserved) throw new DealError("This deal just filled up or closed");

  const undoSlot = () => Deal.updateOne({ _id: deal._id }, { $inc: { participantCount: -1 } });

  let auth;
  try {
    auth = await payment.authorize({ amount: deal.product.price * qty, cardNumber });
  } catch (err) {
    await undoSlot();
    throw new DealError(err.message);
  }

  let pledge;
  try {
    pledge = await Pledge.create({
      deal: deal._id,
      user: userId,
      qty,
      address,
      authorizedAmount: deal.product.price * qty,
      authRef: auth.ref,
      cardLast4: auth.last4,
    });
  } catch (err) {
    await payment.release(auth.ref);
    await undoSlot();
    if (err.code === 11000) throw new DealError("You have already joined this deal");
    throw err;
  }

  const snap = pricing.snapshot(deal.product.price, reserved.tiers, reserved.participantCount);
  await Deal.updateOne(
    { _id: deal._id },
    { $push: { events: { type: "join", count: reserved.participantCount, price: snap.currentPrice } } }
  );

  // Sold out (cap reached) -> settle immediately instead of waiting for the timer.
  if (reserved.maxParticipants && reserved.participantCount >= reserved.maxParticipants) {
    await closeDeal(deal._id);
  }
  return pledge;
}

/** Withdraw from an open deal: the card hold is released and the slot freed. */
async function leaveDeal(dealId, userId) {
  const now = new Date();
  const deal = await Deal.findOne({ _id: dealId, status: "open", endsAt: { $gt: now } }).populate("product");
  if (!deal) throw new DealError("You can only withdraw while a deal is still open");
  const pledge = await Pledge.findOneAndDelete({ deal: deal._id, user: userId, status: "authorized" });
  if (!pledge) throw new DealError("You have not joined this deal");

  await payment.release(pledge.authRef);
  const updated = await Deal.findByIdAndUpdate(deal._id, { $inc: { participantCount: -1 } }, { new: true });
  const snap = pricing.snapshot(deal.product.price, updated.tiers, updated.participantCount);
  await Deal.updateOne(
    { _id: deal._id },
    { $push: { events: { type: "leave", count: updated.participantCount, price: snap.currentPrice } } }
  );
  return pledge;
}

module.exports = { closeDeal, closeExpiredDeals, startScheduler, joinDeal, leaveDeal, DealError };
