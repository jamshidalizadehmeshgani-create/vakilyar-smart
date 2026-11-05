const { getLawyerSession, redis } = require("../../lib/lawyer-auth");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "فقط GET مجاز است." }); }
  try {
    const session = await getLawyerSession(req, res);
    if (!session) return res.status(401).json({ error: "نشست معتبر نیست یا دسترسی شما غیرفعال است." });
    const ids = await redis(["LRANGE", "vy:lawyer:" + session.lawyer.id + ":questions", "0", "99"]) || [];
    const rows = await Promise.all(ids.map(async id => {
      const raw = await redis(["GET", "vy:question:" + id]);
      if (!raw) return null;
      try { const q = JSON.parse(raw); return q && q.lawyer_id === session.lawyer.id ? q : null; } catch { return null; }
    }));
    return res.status(200).json({ ok: true, questions: rows.filter(Boolean) });
  } catch (e) {
    console.error("Lawyer questions error:", e.message);
    return res.status(503).json({ error: "دریافت پرسش‌ها موقتاً ممکن نیست." });
  }
};
