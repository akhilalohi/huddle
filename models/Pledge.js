const mongoose = require("mongoose");

/**
 * A person's commitment to a deal. Their card is HELD (authorized) at the list
 * price; it is captured at the final price only if the deal succeeds.
 * Only the last 4 digits of the card are ever stored.
 */
const pledgeSchema = new mongoose.Schema(
  {
    deal: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    qty: { type: Number, required: true, min: 1 },
    address: { type: String, required: true },
    authorizedAmount: { type: Number, required: true },
    authRef: { type: String, required: true },
    cardLast4: { type: String },
    status: {
      type: String,
      enum: ["authorized", "captured", "released", "withdrawn"],
      default: "authorized",
    },
    finalAmount: Number,
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  },
  { timestamps: true }
);

// One pledge per person per deal.
pledgeSchema.index({ deal: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Pledge", pledgeSchema);
