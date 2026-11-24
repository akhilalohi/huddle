const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  productCode: { type: String, required: true, unique: true, trim: true },
  imagePath: { type: String, trim: true, default: "" },
  description: { type: String, required: true },
  price: { type: Number, required: true, min: 1 },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  manufacturer: { type: String, trim: true, default: "" },
  available: { type: Boolean, default: true },
  // Products are prioritised on the site by this date ("Latest Products").
  createdAt: { type: Date, default: Date.now },
});

productSchema.index({ title: "text" });
productSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Product", productSchema);
