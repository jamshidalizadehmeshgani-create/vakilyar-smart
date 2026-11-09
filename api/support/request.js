const crypto = require("crypto");
const { getUid, consumeIpRateLimit, redis } = require("../../lib/quota");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "فقط درخواست POST پذیرفته می‌شود." });
  }
  const host = String(req.headers?.host || "").toLowerCase();
  let originHost = "";
  try { originHost = new URL(req.headers?.origin || "").host.toLowerCase(); } catch {}
  const fetchSite = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (!host || !originHost || originHost !== host || (fetchSite && fetchSite !== "same-origin")) {
    return res.status(403).json({ error: "مبدأ درخواست معتبر نیست؛ صفحه را تازه‌سازی و دوباره تلاش کنید." });
  }
  try {
    const limit = await consumeIpRateLimit(req, { scope: "support", limit: 5, windowSeconds: 3600 });
    if (limit.count > limit.limit) {
      res.setHeader("Retry-After", String(limit.windowSeconds));
      return res.status(429).json({ code: "SUPPORT_RATE_LIMITED", error: "تعداد درخواست‌های پشتیبانی بیش از حد مجاز است؛ بعداً دوباره تلاش کنید." });
    }
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const category = typeof req.body?.category === "string" ? req.body.category : "account";
    const contact = typeof req.body?.contact === "string" ? req.body.contact.trim().slice(0, 190) : "";
    if (message.length < 10 || message.length > 3000) return res.status(400).json({ error: "شرح مشکل باید بین ۱۰ تا ۳۰۰۰ نویسه باشد." });
    if (!["account", "access", "technical", "other"].includes(category)) return res.status(400).json({ error: "دسته‌بندی درخواست معتبر نیست." });
    const uid = getUid(req, res);
    const id = crypto.randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const item = { id, user_id: uid, category, message, contact, status: "pending", created_at: now, updated_at: now };
    const script = "redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); redis.call('LPUSH',KEYS[2],ARGV[3]); redis.call('LTRIM',KEYS[2],'0','499'); return 1";
    await redis(["EVAL", script, "2", `vy:support:case:${id}`, "vy:support:inbox", JSON.stringify(item), "7776000", id]);
    return res.status(201).json({ ok: true, case_id: id, status: "pending", message: "درخواست شما در صندوق بررسی مدیر ثبت شد. شناسه پیگیری را نگه دارید." });
  } catch (error) {
    const code = error?.code === "CLIENT_IP_UNAVAILABLE" ? "CLIENT_IP_UNAVAILABLE" : "SUPPORT_UNAVAILABLE";
    return res.status(503).json({ ok: false, code, error: "ثبت درخواست پشتیبانی موقتاً ممکن نیست؛ کمی بعد دوباره تلاش کنید." });
  }
};
