/**
 * Mock payment gateway with a real "authorize -> capture / release" lifecycle.
 *
 * Group-buying needs this lifecycle: when you join a deal your card is only
 * HELD for the full list price. If the deal succeeds the hold is CAPTURED for
 * the (lower) final price; if it fails the hold is RELEASED and nothing is
 * charged.
 *
 * This is a test-mode simulation: no real card data is ever stored. Only the
 * last 4 digits and an opaque reference id are kept. To go live, replace the
 * three functions below with Razorpay / Stripe calls (Stripe: PaymentIntent
 * with capture_method = "manual"). The rest of the app does not change.
 */
const crypto = require("crypto");

/** Luhn checksum - the same check real card forms use. */
function luhnValid(cardNumber) {
  const digits = String(cardNumber).replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function expiryValid(expiry, now = new Date()) {
  const m = /^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/.exec(String(expiry).trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  // card is valid through the last day of its expiry month
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  return endOfMonth >= now;
}

const store = new Map(); // in-memory ledger of holds (demo only)

function newRef(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Place a hold. Test rule: a card number ending in 0002 is always declined,
 * which lets you demo the failure path.
 */
async function authorize({ amount, cardNumber }) {
  const digits = String(cardNumber).replace(/\D/g, "");
  if (digits.endsWith("0002")) {
    const err = new Error("Your card was declined (test card ending 0002)");
    err.code = "CARD_DECLINED";
    throw err;
  }
  const ref = newRef("auth");
  store.set(ref, { amount, status: "held" });
  return { ref, last4: digits.slice(-4) };
}

/** Capture up to the held amount. Capturing less releases the difference. */
async function capture(ref, amount) {
  const hold = store.get(ref);
  // After a server restart the in-memory ledger is gone; treat unknown refs as
  // captured so demo data keeps working. A real gateway keeps this state.
  if (hold && amount > hold.amount) {
    throw new Error("Cannot capture more than the authorized amount");
  }
  if (hold) {
    hold.status = "captured";
    hold.captured = amount;
  }
  return { ref: newRef("pay"), amount };
}

async function release(ref) {
  const hold = store.get(ref);
  if (hold) hold.status = "released";
  return { ref, released: true };
}

/** One-shot charge used by the normal cart checkout. */
async function charge({ amount, cardNumber }) {
  const held = await authorize({ amount, cardNumber });
  const paid = await capture(held.ref, amount);
  return { ref: paid.ref, last4: held.last4 };
}

module.exports = { luhnValid, expiryValid, authorize, capture, release, charge };
