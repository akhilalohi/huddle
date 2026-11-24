/** Redirect target "back to where the user came from", same-site only. */
module.exports = function backUrl(req, fallback = "/") {
  try {
    const u = new URL(req.get("referer") || "", `http://${req.get("host")}`);
    return u.host === req.get("host") ? u.pathname + u.search : fallback;
  } catch (_) {
    return fallback;
  }
};
