const crypto = require("crypto");

/** Access control: three levels - guest, customer, admin. */
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  req.flash("error", "Please sign in first");
  res.redirect("/user/signin");
}

function notLoggedIn(req, res, next) {
  if (!req.isAuthenticated()) return next();
  res.redirect("/");
}

function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === "admin") return next();
  req.flash("error", "Admin access only");
  res.redirect(req.isAuthenticated() ? "/" : "/user/signin");
}

/** Minimal CSRF protection: a per-session token that every POST form must echo. */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString("hex");
  res.locals.csrfToken = req.session.csrf;

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const sent = req.body && req.body._csrf;
  if (!sent || sent.length !== req.session.csrf.length) {
    return res.status(403).render("error", { pageName: "Forbidden", message: "Invalid or missing form token. Please go back and try again." });
  }
  const ok = crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf));
  if (!ok) {
    return res.status(403).render("error", { pageName: "Forbidden", message: "Invalid or missing form token. Please go back and try again." });
  }
  next();
}

module.exports = { isLoggedIn, notLoggedIn, isAdmin, csrf };
