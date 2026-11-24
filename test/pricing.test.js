const test = require("node:test");
const assert = require("node:assert/strict");
const pricing = require("../lib/pricing");
const payment = require("../lib/payment");

const TIERS = [
  { minParticipants: 5, discountPercent: 10 },
  { minParticipants: 15, discountPercent: 25 },
  { minParticipants: 30, discountPercent: 40 },
];

test("price is the list price until the first tier is reached", () => {
  assert.equal(pricing.priceAt(1000, TIERS, 0), 1000);
  assert.equal(pricing.priceAt(1000, TIERS, 4), 1000);
});

test("each tier applies from exactly its threshold", () => {
  assert.equal(pricing.priceAt(1000, TIERS, 5), 900);
  assert.equal(pricing.priceAt(1000, TIERS, 14), 900);
  assert.equal(pricing.priceAt(1000, TIERS, 15), 750);
  assert.equal(pricing.priceAt(1000, TIERS, 30), 600);
  assert.equal(pricing.priceAt(1000, TIERS, 500), 600);
});

test("tiers given out of order are sorted", () => {
  const shuffled = [TIERS[2], TIERS[0], TIERS[1]];
  assert.equal(pricing.priceAt(1000, shuffled, 20), 750);
});

test("prices are rounded to whole rupees", () => {
  assert.equal(pricing.priceAt(999, TIERS, 5), 899); // 899.1 -> 899
});

test("threshold: deal only goes ahead at the first tier's count", () => {
  assert.equal(pricing.thresholdMet(TIERS, 4), false);
  assert.equal(pricing.thresholdMet(TIERS, 5), true);
  assert.equal(pricing.thresholdMet([], 10), false);
});

test("snapshot reports what is needed for the next tier", () => {
  const s = pricing.snapshot(1000, TIERS, 12);
  assert.equal(s.currentPrice, 900);
  assert.equal(s.nextPrice, 750);
  assert.equal(s.needed, 3);
  assert.equal(s.thresholdMet, true);
  assert.equal(s.percentToTop, 40);
});

test("snapshot at the top tier has no next tier", () => {
  const s = pricing.snapshot(1000, TIERS, 31);
  assert.equal(s.nextTier, null);
  assert.equal(s.needed, 0);
  assert.equal(s.percentToTop, 100);
});

test("validateTiers accepts a good ladder", () => {
  assert.deepEqual(pricing.validateTiers(TIERS), []);
});

test("validateTiers rejects bad ladders", () => {
  assert.ok(pricing.validateTiers([]).length > 0);
  assert.ok(pricing.validateTiers([{ minParticipants: 1, discountPercent: 10 }]).length > 0);
  assert.ok(pricing.validateTiers([{ minParticipants: 5, discountPercent: 95 }]).length > 0);
  // second tier must need more people AND give a bigger discount
  assert.ok(
    pricing.validateTiers([
      { minParticipants: 5, discountPercent: 20 },
      { minParticipants: 10, discountPercent: 10 },
    ]).length > 0
  );
  assert.ok(
    pricing.validateTiers([
      { minParticipants: 5, discountPercent: 10 },
      { minParticipants: 5, discountPercent: 20 },
    ]).length > 0
  );
});

test("luhn check accepts the standard test card and rejects typos", () => {
  assert.equal(payment.luhnValid("4242 4242 4242 4242"), true);
  assert.equal(payment.luhnValid("4242424242424241"), false);
  assert.equal(payment.luhnValid("1234"), false);
});

test("expiry check", () => {
  const now = new Date(2026, 10, 22);
  assert.equal(payment.expiryValid("11/26", now), true); // valid through end of Nov 2026
  assert.equal(payment.expiryValid("10/26", now), false);
  assert.equal(payment.expiryValid("13/30", now), false);
  assert.equal(payment.expiryValid("abc", now), false);
});

test("authorize -> capture less than held works; capturing more is refused", async () => {
  const held = await payment.authorize({ amount: 1000, cardNumber: "4242424242424242" });
  assert.equal(held.last4, "4242");
  await assert.rejects(() => payment.capture(held.ref, 1500));
  const paid = await payment.capture(held.ref, 750);
  assert.equal(paid.amount, 750);
});

test("test card ending 0002 is declined", async () => {
  await assert.rejects(() => payment.authorize({ amount: 100, cardNumber: "4000000000000002" }), /declined/);
});

test("parseDateTimeLocal uses the admin's timezone offset, not the server's", () => {
  const { parseDateTimeLocal } = require("../lib/helpers");
  // 18:30 typed in IST (browser offset -330) is 13:00 UTC
  assert.equal(parseDateTimeLocal("2026-11-23T18:30", -330).toISOString(), "2026-11-23T13:00:00.000Z");
  assert.equal(parseDateTimeLocal("2026-11-23T18:30", "-330").toISOString(), "2026-11-23T13:00:00.000Z");
  assert.equal(parseDateTimeLocal("2026-11-23T18:30", 0).toISOString(), "2026-11-23T18:30:00.000Z");
  assert.ok(isNaN(parseDateTimeLocal("garbage", 0)));
  assert.ok(isNaN(parseDateTimeLocal("", 0)));
});
