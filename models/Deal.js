const mongoose = require("mongoose");
const pricing = require("../lib/pricing");

/**
 * A group-buy deal on one product.
 *
 * Order state machine:  open -> closing -> succeeded | failed
 * ("closing" is a short-lived lock so two server ticks can never settle the
 *  same deal twice.)
 */
const dealSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    tiers: [
      {
        _id: false,
        minParticipants: { type: Number, required: true },
        discountPercent: { type: Number, required: true },
      },
    ],
    endsAt: { type: Date, required: true },
    // 0 means unlimited. When the cap is reached the deal closes early.
    maxParticipants: { type: Number, default: 0, min: 0 },
    maxQtyPerPerson: { type: Number, default: 3, min: 1 },
    status: {
      type: String,
      enum: ["open", "closing", "succeeded", "failed"],
      default: "open",
    },
    // Denormalised counter, updated atomically so the cap can never be exceeded.
    participantCount: { type: Number, default: 0 },
    finalPrice: Number,
    finalParticipants: Number,
    // Live activity feed: how the price moved as people joined / left.
    events: [
      {
        _id: false,
        at: { type: Date, default: Date.now },
        type: { type: String, enum: ["join", "leave"] },
        count: Number,
        price: Number,
      },
    ],
  },
  { timestamps: true }
);

dealSchema.index({ status: 1, endsAt: 1 });

dealSchema.methods.snapshot = function (basePrice) {
  return pricing.snapshot(basePrice, this.tiers, this.participantCount);
};

module.exports = mongoose.model("Deal", dealSchema);
