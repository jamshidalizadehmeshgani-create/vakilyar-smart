const { getAccount, redis } = require("../../lib/quota");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "فقط GET مجاز است." }); }
  try {
    const account = await getAccount(req, res);
    const ids = await redis(["LRANGE", "vy:user:" + account.uid + ":questions", "0", "99"]) || [];
    const questions = await Promise.all(ids.map(async id => {
      const raw = await redis(["GET", "vy:question:" + id]);
      if (!raw) return null;
      try {
        const q = JSON.parse(raw);
        if (!q || q.user_id !== account.uid) return null;
        return { id: q.id, lawyer_name: q.lawyer_name, question: q.question, status: q.status, created_at: q.created_at, updated_at: q.updated_at || null, replies: Array.isArray(q.replies) ? q.replies.map(a => ({ lawyer_name: a.lawyer_name, message: a.message, created_at: a.created_at })) : [] };
      } catch { return null; }
    }));
    return res.status(200).json({ ok: true, questions: questions.filter(Boolean) });
  } catch (e) {
    console.error("User questions error:", e.message);
    return res.status(503).json({ error: "دریافت پرسش‌ها موقتاً ممکن نیست." });
  }
};
