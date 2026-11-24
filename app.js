require("dotenv").config();
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const helmet = require("helmet");

const passport = require("./config/passport");
const helpers = require("./lib/helpers");
const { csrf } = require("./middleware");
const { startScheduler } = require("./lib/dealEngine");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/huddle";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-secret-change-me";
if (!process.env.SESSION_SECRET) {
  console.warn("WARNING: SESSION_SECRET is not set. Copy .env.example to .env and set one.");
}

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, "public")));

// Generated SVG placeholder for products that have no image yet.
app.get("/img/placeholder/:text.svg", (req, res) => {
  res.type("image/svg+xml").set("Cache-Control", "public, max-age=86400");
  res.send(helpers.placeholderSvg(String(req.params.text).slice(0, 60)));
});

app.use(express.urlencoded({ extended: false, limit: "50kb" }));

// Session management (Experiment 7): the session lives in MongoDB, the browser
// only holds an opaque, signed session-id cookie. Expires after 3 hours.
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      // Default (real MongoDB) uses a TTL index. Set SESSION_AUTOREMOVE=interval
      // for MongoDB-compatible servers that don't support TTL indexes.
      ...(process.env.SESSION_AUTOREMOVE === "interval"
        ? { autoRemove: "interval", autoRemoveInterval: 10 }
        : {}),
    }),
    cookie: { maxAge: 3 * 60 * 60 * 1000, httpOnly: true, sameSite: "lax" },
  })
);
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

// Values available in every EJS template. (Must come BEFORE the CSRF check so
// the 403 error page can render the header.)
app.use((req, res, next) => {
  Object.assign(res.locals, helpers);
  res.locals.currentUser = req.user || null;
  res.locals.pageName = "";
  res.locals.cartQty = (req.session.cart && req.session.cart.totalQty) || 0;
  // JSON polling endpoints must not swallow the page's flash messages.
  if (req.path.endsWith(".json")) {
    res.locals.success = [];
    res.locals.error = [];
  } else {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
  }
  next();
});
app.use(csrf);

app.use("/", require("./routes/index"));
app.use("/products", require("./routes/products"));
app.use("/cart", require("./routes/cart"));
app.use("/deals", require("./routes/deals"));
app.use("/user", require("./routes/user"));
app.use("/admin", require("./routes/admin"));

app.use((req, res) => {
  res.status(404).render("error", { pageName: "Not found", message: "We couldn't find that page." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const message = process.env.NODE_ENV === "production" ? "Something went wrong." : err.message;
  res.status(500).render("error", { pageName: "Error", message });
});

async function start() {
  await mongoose.connect(MONGODB_URI);
  console.log("MongoDB connected");
  startScheduler(Number(process.env.DEAL_CHECK_INTERVAL_MS) || 30000);
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Huddle running on http://localhost:${port}`));
}

if (require.main === module) {
  start().catch((err) => {
    console.error("Could not start:", err.message);
    process.exit(1);
  });
}

module.exports = app;
