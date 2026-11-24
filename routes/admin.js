const router = require("express").Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const Category = require("../models/Category");
const Product = require("../models/Product");
const Deal = require("../models/Deal");
const Pledge = require("../models/Pledge");
const Order = require("../models/Order");
const Message = require("../models/Message");
const pricing = require("../lib/pricing");
const { parseDateTimeLocal } = require("../lib/helpers");
const { closeDeal, closeExpiredDeals, joinDeal, DealError } = require("../lib/dealEngine");
const { isAdmin } = require("../middleware");
const v = require("../middleware/validators");

// Everything under /admin needs an admin account (Experiment 6: access control).
router.use(isAdmin);

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function validId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) return next("route");
  next();
}

/* ------------------------------ dashboard ------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    await closeExpiredDeals();
    const [products, users, orders, openDeals, revenue, savedAgg, recent] = await Promise.all([
      Product.countDocuments(),
      User.countDocuments({ role: "customer" }),
      Order.countDocuments(),
      Deal.countDocuments({ status: "open" }),
      Order.aggregate([{ $match: { status: { $ne: "Cancelled" } } }, { $group: { _id: null, t: { $sum: "$totalCost" } } }]),
      Order.aggregate([{ $group: { _id: null, t: { $sum: "$totalSaved" } } }]),
      Order.find().sort("-createdAt").limit(6).populate("user", "username email"),
    ]);
    res.render("admin/dashboard", {
      pageName: "Admin",
      stats: {
        products,
        users,
        orders,
        openDeals,
        revenue: revenue[0] ? revenue[0].t : 0,
        saved: savedAgg[0] ? savedAgg[0].t : 0,
      },
      recent,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------- products ------------------------------ */
router.get("/products", async (req, res, next) => {
  try {
    const products = await Product.find().sort("-createdAt").populate("category");
    res.render("admin/products", { pageName: "Admin - Products", products });
  } catch (err) {
    next(err);
  }
});

async function productForm(res, status, { product = {}, errors = [], action, heading }) {
  const categories = await Category.find().sort("title");
  res.status(status).render("admin/product-form", { pageName: heading, product, errors, categories, action, heading });
}

router.get("/products/new", async (req, res, next) => {
  try {
    await productForm(res, 200, { action: "/admin/products", heading: "Create new product" });
  } catch (err) {
    next(err);
  }
});

function productFromBody(b) {
  return {
    title: b.title.trim(),
    productCode: b.productCode.trim(),
    imagePath: (b.imagePath || "").trim(),
    description: b.description.trim(),
    price: Number(b.price),
    category: b.category,
    manufacturer: (b.manufacturer || "").trim(),
    available: b.available === "on",
    createdAt: b.createdAt ? new Date(b.createdAt) : new Date(),
  };
}

router.post("/products", v.productRules(), async (req, res, next) => {
  try {
    const errors = v.errorsOf(req);
    if (errors.length) {
      return productForm(res, 422, { product: req.body, errors, action: "/admin/products", heading: "Create new product" });
    }
    try {
      await Product.create(productFromBody(req.body));
    } catch (err) {
      if (err.code === 11000) {
        return productForm(res, 409, {
          product: req.body,
          errors: ["That product code is already used"],
          action: "/admin/products",
          heading: "Create new product",
        });
      }
      throw err;
    }
    req.flash("success", "Product created");
    res.redirect("/admin/products");
  } catch (err) {
    next(err);
  }
});

router.get("/products/:id/edit", validId, async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next();
    await productForm(res, 200, { product, action: `/admin/products/${product._id}`, heading: "Edit product" });
  } catch (err) {
    next(err);
  }
});

router.post("/products/:id", validId, v.productRules(), async (req, res, next) => {
  try {
    const errors = v.errorsOf(req);
    const action = `/admin/products/${req.params.id}`;
    if (errors.length) {
      return productForm(res, 422, { product: { ...req.body, _id: req.params.id }, errors, action, heading: "Edit product" });
    }
    try {
      await Product.findByIdAndUpdate(req.params.id, productFromBody(req.body), { runValidators: true });
    } catch (err) {
      if (err.code === 11000) {
        return productForm(res, 409, {
          product: { ...req.body, _id: req.params.id },
          errors: ["That product code is already used"],
          action,
          heading: "Edit product",
        });
      }
      throw err;
    }
    req.flash("success", "Product updated");
    res.redirect("/admin/products");
  } catch (err) {
    next(err);
  }
});

router.post("/products/:id/delete", validId, async (req, res, next) => {
  try {
    if (await Deal.exists({ product: req.params.id, status: { $in: ["open", "closing"] } })) {
      req.flash("error", "This product has a live group deal. Settle the deal first.");
      return res.redirect("/admin/products");
    }
    await Product.findByIdAndDelete(req.params.id);
    req.flash("success", "Product deleted");
    res.redirect("/admin/products");
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ categories ----------------------------- */
router.get("/categories", async (req, res, next) => {
  try {
    const categories = await Category.find().sort("title");
    const counts = await Product.aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }]);
    const countOf = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
    res.render("admin/categories", { pageName: "Admin - Categories", categories, countOf, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post("/categories", v.categoryRules(), async (req, res, next) => {
  try {
    const errors = v.errorsOf(req);
    if (errors.length) {
      req.flash("error", errors[0]);
      return res.redirect("/admin/categories");
    }
    const title = req.body.title.trim();
    try {
      await Category.create({ title, slug: slugify(title) });
      req.flash("success", "Category added");
    } catch (err) {
      if (err.code !== 11000) throw err;
      req.flash("error", "That category already exists");
    }
    res.redirect("/admin/categories");
  } catch (err) {
    next(err);
  }
});

router.post("/categories/:id/delete", validId, async (req, res, next) => {
  try {
    if (await Product.exists({ category: req.params.id })) {
      req.flash("error", "Move or delete the products in this category first");
    } else {
      await Category.findByIdAndDelete(req.params.id);
      req.flash("success", "Category deleted");
    }
    res.redirect("/admin/categories");
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- deals ------------------------------- */
router.get("/deals", async (req, res, next) => {
  try {
    await closeExpiredDeals();
    const deals = await Deal.find().sort("-createdAt").populate("product");
    res.render("admin/deals", {
      pageName: "Admin - Deals",
      deals: deals.filter((d) => d.product).map((d) => ({ deal: d, snap: d.snapshot(d.product.price) })),
    });
  } catch (err) {
    next(err);
  }
});

async function dealForm(res, status, { form = {}, errors = [] }) {
  const products = await Product.find({ available: true }).sort("title");
  res.status(status).render("admin/deal-form", { pageName: "Admin - New Deal", products, errors, form });
}

router.get("/deals/new", async (req, res, next) => {
  try {
    await dealForm(res, 200, {
      form: { tiers: [{ minParticipants: 5, discountPercent: 10 }, { minParticipants: 15, discountPercent: 25 }, { minParticipants: 30, discountPercent: 40 }], maxQtyPerPerson: 3, maxParticipants: 0 },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/deals", v.dealRules(), async (req, res, next) => {
  try {
    const tiers = pricing.normalizeTiers(v.parseTiers(req.body));
    const form = { ...req.body, tiers };
    const errors = v.errorsOf(req);
    if (!errors.length && (await Deal.exists({ product: req.body.product, status: { $in: ["open", "closing"] } }))) {
      errors.push("That product already has a live deal");
    }
    if (errors.length) return dealForm(res, 422, { form, errors });

    await Deal.create({
      product: req.body.product,
      tiers,
      endsAt: parseDateTimeLocal(req.body.endsAt, req.body.tzOffset),
      maxParticipants: Number(req.body.maxParticipants) || 0,
      maxQtyPerPerson: Number(req.body.maxQtyPerPerson) || 3,
    });
    req.flash("success", "Deal is live");
    res.redirect("/admin/deals");
  } catch (err) {
    next(err);
  }
});

// Demo helper: settle a deal right now instead of waiting for its timer.
router.post("/deals/:id/close", validId, async (req, res, next) => {
  try {
    const deal = await closeDeal(req.params.id);
    req.flash(deal ? "success" : "error", deal ? `Deal settled: ${deal.status}` : "That deal is not open");
    res.redirect("/admin/deals");
  } catch (err) {
    next(err);
  }
});

// Demo helper: add N demo shoppers so you can show the price tiers dropping.
router.post("/deals/:id/simulate", validId, async (req, res, next) => {
  try {
    const n = Math.min(50, Math.max(1, parseInt(req.body.n, 10) || 1));
    let added = 0;
    for (let i = 1; i <= 200 && added < n; i++) {
      const email = `demo${i}@huddle.test`;
      let user = await User.findOne({ email });
      if (!user) {
        user = new User({ username: `Demo Shopper ${i}`, email });
        user.password = user.encryptPassword("Demo@12345");
        await user.save();
      }
      if (await Pledge.exists({ deal: req.params.id, user: user._id })) continue;
      try {
        await joinDeal(req.params.id, user._id, {
          qty: 1,
          address: "Demo address, Delhi 110001",
          cardNumber: "4242424242424242",
        });
        added++;
      } catch (err) {
        if (err instanceof DealError) break; // deal full or closed
        throw err;
      }
    }
    req.flash("success", `Added ${added} demo shopper${added === 1 ? "" : "s"}`);
    res.redirect(`/deals/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- orders ------------------------------- */
router.get("/orders", async (req, res, next) => {
  try {
    const orders = await Order.find().sort("-createdAt").limit(100).populate("user", "username email");
    res.render("admin/orders", { pageName: "Admin - Orders", orders, states: Order.STATES });
  } catch (err) {
    next(err);
  }
});

router.post("/orders/:id/status", validId, async (req, res, next) => {
  try {
    if (!Order.STATES.includes(req.body.status)) {
      req.flash("error", "Unknown status");
      return res.redirect("/admin/orders");
    }
    await Order.findByIdAndUpdate(req.params.id, { status: req.body.status });
    req.flash("success", "Order status updated");
    res.redirect("/admin/orders");
  } catch (err) {
    next(err);
  }
});

/* ------------------------- users and messages -------------------------- */
router.get("/users", async (req, res, next) => {
  try {
    const users = await User.find().sort("-createdAt").select("username email role createdAt");
    res.render("admin/users", { pageName: "Admin - Users", users });
  } catch (err) {
    next(err);
  }
});

router.get("/messages", async (req, res, next) => {
  try {
    const messages = await Message.find().sort("-createdAt").limit(100);
    res.render("admin/messages", { pageName: "Admin - Messages", messages });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
