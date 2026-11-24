const router = require("express").Router();
const mongoose = require("mongoose");
const Deal = require("../models/Deal");
const Pledge = require("../models/Pledge");
const pricing = require("../lib/pricing");
const { closeExpiredDeals, joinDeal, leaveDeal, DealError } = require("../lib/dealEngine");
const { isLoggedIn } = require("../middleware");
const { joinDealRules, errorsOf } = require("../middleware/validators");

function validId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) return next("route");
  next();
}

router.get("/", async (req, res, next) => {
  try {
    await closeExpiredDeals();
    const now = new Date();
    const [open, ended] = await Promise.all([
      Deal.find({ status: "open", endsAt: { $gt: now } }).sort("endsAt").populate("product"),
      Deal.find({ status: { $in: ["succeeded", "failed"] } }).sort("-updatedAt").limit(6).populate("product"),
    ]);
    const wrap = (d) => ({ deal: d, snap: d.snapshot(d.product.price) });
    res.render("deals/index", {
      pageName: "Group Deals",
      open: open.filter((d) => d.product).map(wrap),
      ended: ended.filter((d) => d.product).map(wrap),
    });
  } catch (err) {
    next(err);
  }
});

// Live status for the deal page's auto-refresh (polled every few seconds).
router.get("/:id/status.json", validId, async (req, res, next) => {
  try {
    const deal = await Deal.findById(req.params.id).populate("product");
    if (!deal) return res.status(404).json({ error: "not found" });
    const snap = deal.snapshot(deal.product.price);
    res.json({
      status: deal.status,
      count: snap.count,
      currentPrice: snap.currentPrice,
      nextPrice: snap.nextPrice,
      needed: snap.needed,
      thresholdMet: snap.thresholdMet,
      percentToTop: snap.percentToTop,
      msLeft: Math.max(0, deal.endsAt - new Date()),
      finalPrice: deal.finalPrice || null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", validId, async (req, res, next) => {
  try {
    await closeExpiredDeals();
    const deal = await Deal.findById(req.params.id).populate({ path: "product", populate: "category" });
    if (!deal || !deal.product) return next();

    const snap = deal.snapshot(deal.product.price);
    const myPledge = req.user ? await Pledge.findOne({ deal: deal._id, user: req.user._id }) : null;
    const tiers = pricing.normalizeTiers(deal.tiers).map((t) => ({
      ...t,
      price: pricing.priceAt(deal.product.price, deal.tiers, t.minParticipants),
      reached: snap.count >= t.minParticipants,
    }));

    res.render("deals/show", {
      pageName: deal.product.title + " - Group Deal",
      deal,
      product: deal.product,
      snap,
      tiers,
      myPledge,
      events: [...deal.events].reverse().slice(0, 8),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/join", validId, isLoggedIn, async (req, res, next) => {
  try {
    const deal = await Deal.findById(req.params.id).populate("product");
    if (!deal || !deal.product) return next();
    if (deal.status !== "open" || deal.endsAt <= new Date()) {
      req.flash("error", "This deal has ended");
      return res.redirect(`/deals/${deal._id}`);
    }
    if (await Pledge.exists({ deal: deal._id, user: req.user._id })) {
      req.flash("error", "You have already joined this deal");
      return res.redirect(`/deals/${deal._id}`);
    }
    res.render("deals/join", {
      pageName: "Join Deal",
      deal,
      product: deal.product,
      snap: deal.snapshot(deal.product.price),
      errors: [],
      form: { qty: 1 },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/join", validId, isLoggedIn, joinDealRules(), async (req, res, next) => {
  try {
    const deal = await Deal.findById(req.params.id).populate("product");
    if (!deal || !deal.product) return next();

    const errors = errorsOf(req);
    const qty = parseInt(req.body.qty, 10);
    const form = { qty: req.body.qty, cardName: req.body.cardName, address: req.body.address };
    const redisplay = (status, errs) =>
      res.status(status).render("deals/join", {
        pageName: "Join Deal",
        deal,
        product: deal.product,
        snap: deal.snapshot(deal.product.price),
        errors: errs,
        form,
      });

    if (errors.length) return redisplay(422, errors);

    try {
      await joinDeal(deal._id, req.user._id, {
        qty,
        address: req.body.address.trim(),
        cardNumber: req.body.cardNumber,
      });
    } catch (err) {
      if (err instanceof DealError) return redisplay(409, [err.message]);
      throw err;
    }
    req.flash("success", "You're in! Your card is only held for now - you are charged the final price if the deal succeeds.");
    res.redirect(`/deals/${deal._id}`);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/leave", validId, isLoggedIn, async (req, res, next) => {
  try {
    await leaveDeal(req.params.id, req.user._id);
    req.flash("success", "You've left the deal and your card hold was released.");
    res.redirect(`/deals/${req.params.id}`);
  } catch (err) {
    if (err instanceof DealError) {
      req.flash("error", err.message);
      return res.redirect(`/deals/${req.params.id}`);
    }
    next(err);
  }
});

module.exports = router;
