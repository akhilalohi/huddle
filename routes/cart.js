const router = require("express").Router();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Order = require("../models/Order");
const payment = require("../lib/payment");
const backUrl = require("../lib/back");
const { isLoggedIn } = require("../middleware");
const { cardRules, errorsOf } = require("../middleware/validators");

const MAX_PER_ITEM = 10;

function getCart(req) {
  if (!req.session.cart) req.session.cart = { items: {}, totalQty: 0, totalCost: 0 };
  return req.session.cart;
}

function recalc(cart) {
  let qty = 0;
  let cost = 0;
  for (const item of Object.values(cart.items)) {
    qty += item.qty;
    cost += item.qty * item.price;
  }
  cart.totalQty = qty;
  cart.totalCost = cost;
}

/** Re-read prices from the database so a stale or tampered cart can't be used. */
async function refreshCart(cart) {
  const ids = Object.keys(cart.items);
  const products = await Product.find({ _id: { $in: ids } });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  for (const id of ids) {
    const p = byId.get(id);
    if (!p || !p.available) delete cart.items[id];
    else {
      cart.items[id].price = p.price;
      cart.items[id].title = p.title;
      cart.items[id].imagePath = p.imagePath;
    }
  }
  recalc(cart);
}

router.get("/", async (req, res, next) => {
  try {
    const cart = getCart(req);
    await refreshCart(cart);
    res.render("shop/cart", { pageName: "Shopping Cart", cart, items: Object.entries(cart.items) });
  } catch (err) {
    next(err);
  }
});

router.post("/add/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect("/");
    const product = await Product.findById(req.params.id);
    if (!product || !product.available) {
      req.flash("error", "That product is not available right now");
      return res.redirect(backUrl(req));
    }
    const qty = Math.min(MAX_PER_ITEM, Math.max(1, parseInt(req.body.qty, 10) || 1));
    const cart = getCart(req);
    const id = String(product._id);
    const existing = cart.items[id];
    cart.items[id] = {
      productId: id,
      title: product.title,
      productCode: product.productCode,
      imagePath: product.imagePath,
      price: product.price,
      qty: Math.min(MAX_PER_ITEM, (existing ? existing.qty : 0) + qty),
    };
    recalc(cart);
    req.flash("success", "Item added to the shopping cart");
    res.redirect(backUrl(req));
  } catch (err) {
    next(err);
  }
});

router.post("/update/:id", (req, res) => {
  const cart = getCart(req);
  const item = cart.items[req.params.id];
  if (item) {
    const qty = parseInt(req.body.qty, 10);
    if (!qty || qty < 1) delete cart.items[req.params.id];
    else item.qty = Math.min(MAX_PER_ITEM, qty);
    recalc(cart);
  }
  res.redirect("/cart");
});

router.post("/remove/:id", (req, res) => {
  const cart = getCart(req);
  delete cart.items[req.params.id];
  recalc(cart);
  res.redirect("/cart");
});

router.get("/checkout", isLoggedIn, async (req, res, next) => {
  try {
    const cart = getCart(req);
    await refreshCart(cart);
    if (cart.totalQty === 0) return res.redirect("/cart");
    res.render("shop/checkout", { pageName: "Checkout", cart, errors: [], form: {} });
  } catch (err) {
    next(err);
  }
});

router.post("/checkout", isLoggedIn, cardRules(), async (req, res, next) => {
  try {
    const cart = getCart(req);
    await refreshCart(cart);
    if (cart.totalQty === 0) return res.redirect("/cart");

    const errors = errorsOf(req);
    const form = { cardName: req.body.cardName, address: req.body.address };
    if (errors.length) {
      return res.status(422).render("shop/checkout", { pageName: "Checkout", cart, errors, form });
    }

    let paid;
    try {
      paid = await payment.charge({ amount: cart.totalCost, cardNumber: req.body.cardNumber });
    } catch (err) {
      return res.status(402).render("shop/checkout", { pageName: "Checkout", cart, errors: [err.message], form });
    }

    const items = Object.values(cart.items).map((i) => ({
      product: i.productId,
      title: i.title,
      productCode: i.productCode,
      imagePath: i.imagePath,
      qty: i.qty,
      unitPrice: i.price,
      listPrice: i.price,
    }));
    const order = await Order.create({
      user: req.user._id,
      source: "cart",
      items,
      totalQty: cart.totalQty,
      totalCost: cart.totalCost,
      address: req.body.address.trim(),
      paymentRef: paid.ref,
      cardLast4: paid.last4,
    });

    req.session.cart = null;
    req.flash("success", "Order placed successfully!");
    res.redirect(`/user/orders/${order._id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
