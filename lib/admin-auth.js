const crypto = require("crypto");
const { consumeIpRateLimit } = require("./quota");

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

async function authorizeAdmin(req, res) {
  const host = String(req.headers?.host || "").toLowerCase();
  let originHost = "";
  try { originHost = new URL(req.headers?.origin || "").host.toLowerCase(); } catch {}
  if (!host || !originHost || originHost !== host) {
    res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
    return false;
  }
  try {
    const limit = await consumeIpRateLimit(req, { scope: "admin", limit: 30, windowSeconds: 900 });
    if (limit.count > limit.limit) {
      res.setHeader("Retry-After", String(limit.windowSeconds));
      res.status(429).json({ code: "ADMIN_RATE_LIMITED", error: "تعداد درخواست‌های مدیریتی از این اتصال بیش از حد مجاز است." });
      return false;
    }
  } catch (error) {
    console.error("Admin rate-limit error:", error?.message || error);
    res.status(503).json({ code: "ADMIN_RATE_LIMIT_UNAVAILABLE", error: "کنترل امنیتی پنل مدیریت موقتاً در دسترس نیست." });
    return false;
  }
  const adminKey = process.env.ADMIN_API_KEY;
  const supplied = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!adminKey || !safeEqual(supplied, adminKey)) {
    res.status(401).json({ error: "دسترسی مدیر تأیید نشد." });
    return false;
  }
  return true;
}

module.exports = { authorizeAdmin };
