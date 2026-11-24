/**
 * Pure pricing logic for group-buy deals. No database access here, so it is
 * easy to unit-test (see test/pricing.test.js) and easy to explain in a viva.
 *
 * A deal has a list price and a ladder of tiers, e.g.
 *   [{ minParticipants: 5,  discountPercent: 10 },
 *    { minParticipants: 15, discountPercent: 25 },
 *    { minParticipants: 30, discountPercent: 40 }]
 *
 * - The FIRST tier's minParticipants is the "tipping point": if fewer people
 *   than that join before the timer ends, the deal fails and every hold on a
 *   card is released (nobody is charged).
 * - If the deal succeeds, EVERYONE pays the price of the highest tier reached
 *   (not the price at the moment they joined). Early joiners are not punished.
 */

function normalizeTiers(tiers) {
  return (tiers || [])
    .map((t) => ({
      minParticipants: Number(t.minParticipants),
      discountPercent: Number(t.discountPercent),
    }))
    .sort((a, b) => a.minParticipants - b.minParticipants);
}

/** Returns an array of human-readable error strings ([] means valid). */
function validateTiers(tiers) {
  const errors = [];
  const t = normalizeTiers(tiers);
  if (t.length === 0) return ["Add at least one price tier"];
  if (t.length > 5) errors.push("Use at most 5 tiers");

  t.forEach((tier, i) => {
    if (!Number.isInteger(tier.minParticipants) || tier.minParticipants < 2) {
      errors.push(`Tier ${i + 1}: participants must be a whole number of 2 or more`);
    }
    if (
      !Number.isFinite(tier.discountPercent) ||
      tier.discountPercent < 1 ||
      tier.discountPercent > 90
    ) {
      errors.push(`Tier ${i + 1}: discount must be between 1% and 90%`);
    }
    if (i > 0) {
      if (tier.minParticipants <= t[i - 1].minParticipants) {
        errors.push(`Tier ${i + 1}: participants must be higher than the tier before it`);
      }
      if (tier.discountPercent <= t[i - 1].discountPercent) {
        errors.push(`Tier ${i + 1}: discount must be higher than the tier before it`);
      }
    }
  });
  return errors;
}

/** Highest tier that has been reached with `count` participants (or null). */
function currentTier(tiers, count) {
  const t = normalizeTiers(tiers);
  let reached = null;
  for (const tier of t) {
    if (count >= tier.minParticipants) reached = tier;
  }
  return reached;
}

/** First tier that has NOT been reached yet (or null if the top tier is hit). */
function nextTier(tiers, count) {
  return normalizeTiers(tiers).find((tier) => count < tier.minParticipants) || null;
}

/** Price per unit (whole rupees) if the deal closed with `count` participants. */
function priceAt(basePrice, tiers, count) {
  const tier = currentTier(tiers, count);
  if (!tier) return Math.round(basePrice);
  return Math.round(basePrice * (1 - tier.discountPercent / 100));
}

/** The deal only goes ahead if the first tier's threshold is met. */
function thresholdMet(tiers, count) {
  const t = normalizeTiers(tiers);
  return t.length > 0 && count >= t[0].minParticipants;
}

/**
 * Everything the UI needs about a deal's current state in one object.
 */
function snapshot(basePrice, tiers, count) {
  const t = normalizeTiers(tiers);
  const cur = currentTier(t, count);
  const nxt = nextTier(t, count);
  const topTarget = t.length ? t[t.length - 1].minParticipants : 0;
  return {
    count,
    basePrice: Math.round(basePrice),
    currentTier: cur,
    currentPrice: priceAt(basePrice, t, count),
    nextTier: nxt,
    nextPrice: nxt ? priceAt(basePrice, t, nxt.minParticipants) : null,
    needed: nxt ? nxt.minParticipants - count : 0,
    thresholdMet: thresholdMet(t, count),
    tippingPoint: t.length ? t[0].minParticipants : 0,
    topTarget,
    percentToTop: topTarget ? Math.min(100, Math.round((count / topTarget) * 100)) : 0,
  };
}

module.exports = {
  normalizeTiers,
  validateTiers,
  currentTier,
  nextTier,
  priceAt,
  thresholdMet,
  snapshot,
};
