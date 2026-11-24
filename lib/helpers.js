/** Small view helpers exposed to every EJS template via res.locals. */

function money(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN");
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

/** Product image: real path/URL if given, otherwise a generated SVG placeholder. */
function imgSrc(product) {
  const p = product && product.imagePath;
  if (p && (/^https?:\/\//i.test(p) || p.startsWith("/"))) return p;
  const label = encodeURIComponent((product && product.title) || "Huddle");
  return `/img/placeholder/${label}.svg`;
}

function placeholderSvg(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const initials = escapeXml(
    text
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "H"
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 480">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${h},70%,82%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},65%,68%)"/>
  </linearGradient></defs>
  <rect width="400" height="480" fill="url(#g)"/>
  <text x="200" y="265" font-family="Georgia,serif" font-size="120" text-anchor="middle" fill="rgba(255,255,255,.85)">${initials}</text>
</svg>`;
}

function timeLeft(date, now = new Date()) {
  const ms = new Date(date) - now;
  if (ms <= 0) return "Ended";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

/**
 * Parse a <input type="datetime-local"> value ("2026-11-23T18:30") that was typed
 * in the ADMIN'S timezone. The browser sends its offset (minutes, as returned by
 * Date.getTimezoneOffset(): IST = -330) in a hidden field, so the result is the
 * right instant no matter where the server runs. Without an offset it falls back
 * to the server's own timezone.
 */
function parseDateTimeLocal(value, offsetMinutes) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ""));
  if (!m) return new Date(NaN);
  const off = Number(offsetMinutes);
  if (offsetMinutes === undefined || offsetMinutes === "" || !Number.isFinite(off)) {
    return new Date(String(value));
  }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + off * 60000);
}

module.exports = { money, escapeRegex, escapeXml, imgSrc, placeholderSvg, timeLeft, parseDateTimeLocal };
