const router = require("express").Router();
const Product = require("../models/Product");
const Deal = require("../models/Deal");
const Message = require("../models/Message");
const { closeExpiredDeals } = require("../lib/dealEngine");
const { contactRules, errorsOf } = require("../middleware/validators");

router.get("/", async (req, res, next) => {
  try {
    await closeExpiredDeals(); // settle anything overdue so the home page is never stale
    const [latest, deals] = await Promise.all([
      Product.find({ available: true }).sort("-createdAt").limit(6).populate("category"),
      Deal.find({ status: "open", endsAt: { $gt: new Date() } }).sort("endsAt").limit(4).populate("product"),
    ]);
    const liveDeals = deals
      .filter((d) => d.product)
      .map((d) => ({ deal: d, snap: d.snapshot(d.product.price) }));
    res.render("home", { pageName: "Home", latest, liveDeals });
  } catch (err) {
    next(err);
  }
});

router.get("/contact", (req, res) => {
  res.render("contact", { pageName: "Contact Us", errors: [], form: {} });
});

router.post("/contact", contactRules(), async (req, res, next) => {
  try {
    const errors = errorsOf(req);
    const form = { name: req.body.name, email: req.body.email, message: req.body.message };
    if (errors.length) return res.status(422).render("contact", { pageName: "Contact Us", errors, form });
    await Message.create(form);
    req.flash("success", "Thanks! We'll get back to you soon.");
    res.redirect("/contact");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
