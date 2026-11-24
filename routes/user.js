const router = require("express").Router();
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const passport = require("../config/passport");
const Order = require("../models/Order");
const Pledge = require("../models/Pledge");
const { isLoggedIn, notLoggedIn } = require("../middleware");
const { signUpRules, signInRules, errorsOf } = require("../middleware/validators");

// Slow down password guessing: 10 sign-in attempts per 15 minutes per IP.
const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true, // only failed attempts count towards the limit
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).render("user/signin", {
      pageName: "Sign In",
      errors: ["Too many attempts. Please wait a few minutes and try again."],
      form: {},
    }),
});

function finishLogin(req, res, next, user) {
  // keepSessionInfo so a guest's cart survives signing in.
  req.logIn(user, { keepSessionInfo: true }, (err) => {
    if (err) return next(err);
    const dest = req.session.returnTo || (user.role === "admin" ? "/admin" : "/user/profile");
    delete req.session.returnTo;
    res.redirect(dest);
  });
}

router.get("/signup", notLoggedIn, (req, res) => {
  res.render("user/signup", { pageName: "Sign Up", errors: [], form: {} });
});

router.post("/signup", notLoggedIn, signUpRules(), (req, res, next) => {
  const errors = errorsOf(req);
  const form = { name: req.body.name, email: req.body.email };
  if (errors.length) return res.status(422).render("user/signup", { pageName: "Sign Up", errors, form });

  passport.authenticate("local.signup", (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      return res.status(422).render("user/signup", { pageName: "Sign Up", errors: [info.message], form });
    }
    finishLogin(req, res, next, user);
  })(req, res, next);
});

router.get("/signin", notLoggedIn, (req, res) => {
  res.render("user/signin", { pageName: "Sign In", errors: [], form: {} });
});

router.post("/signin", notLoggedIn, signInLimiter, signInRules(), (req, res, next) => {
  const errors = errorsOf(req);
  const form = { email: req.body.email };
  if (errors.length) return res.status(422).render("user/signin", { pageName: "Sign In", errors, form });

  passport.authenticate("local.signin", (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).render("user/signin", { pageName: "Sign In", errors: [info.message], form });
    }
    finishLogin(req, res, next, user);
  })(req, res, next);
});

router.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect("/"));
  });
});

router.get("/profile", isLoggedIn, async (req, res, next) => {
  try {
    const [orders, pledges] = await Promise.all([
      Order.find({ user: req.user._id }).sort("-createdAt"),
      Pledge.find({ user: req.user._id, status: "authorized" })
        .sort("-createdAt")
        .populate({ path: "deal", populate: "product" }),
    ]);
    const saved = orders.reduce((sum, o) => sum + (o.totalSaved || 0), 0);
    res.render("user/profile", {
      pageName: "My Account",
      orders,
      pledges: pledges.filter((p) => p.deal && p.deal.product),
      saved,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/orders/:id", isLoggedIn, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return next();
    // Filtering by user means you can only ever open your own orders.
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) return next();
    res.render("user/order", { pageName: "Order Details", order, states: Order.STATES.filter((s) => s !== "Cancelled") });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
