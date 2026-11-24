const mongoose = require("mongoose");

const ORDER_STATES = ["Confirmed", "Packed", "Shipped", "Delivered", "Cancelled"];

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    source: { type: String, enum: ["cart", "group-deal"], default: "cart" },
    items: [
      {
        _id: false,
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        title: String,
        productCode: String,
        imagePath: String,
        qty: Number,
        unitPrice: Number, // price actually paid per unit
        listPrice: Number, // price before any group discount
      },
    ],
    totalQty: Number,
    totalCost: Number,
    totalSaved: { type: Number, default: 0 },
    address: { type: String, required: true },
    paymentRef: String,
    cardLast4: String,
    deal: { type: mongoose.Schema.Types.ObjectId, ref: "Deal" },
    status: { type: String, enum: ORDER_STATES, default: "Confirmed" },
  },
  { timestamps: true }
);

orderSchema.statics.STATES = ORDER_STATES;

module.exports = mongoose.model("Order", orderSchema);
