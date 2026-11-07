const { getLawyerSession } = require("../../lib/lawyer-auth");
const { consumeIpRateLimit } = require("../../lib/quota");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "فقط GET مجاز است." }); }
  try {
    const limit = await consumeIpRateLimit(req, { scope: "lawyer-me", limit: 120, windowSeconds: 900 });
    if (limit.count > limit.limit) {
      res.setHeader("Retry-After", String(limit.windowSeconds));
      return res.status(429).json({ code: "LAWYER_PROFILE_RATE_LIMITED", error: "درخواست‌های پروفایل از این اتصال بیش از حد مجاز است." });
    }
    const session = await getLawyerSession(req, res);
    if (!session) return res.status(401).json({ error: "نشست معتبر نیست یا دسترسی وکیل غیرفعال شده است." });
    const w = session.lawyer;
    return res.status(200).json({ ok: true, lawyer: { id: w.id, name: w.name, email: w.email, license_number: w.license_number || "" } });
  } catch (error) {
    console.error("Lawyer session error:", error.message);
    return res.status(503).json({ error: "بررسی نشست موقتاً ممکن نیست." });
  }
};
