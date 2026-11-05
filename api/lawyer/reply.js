const crypto = require("crypto");
const { getLawyerSession, redis } = require("../../lib/lawyer-auth");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (req.headers.origin) { const host = req.headers.host || ""; let originHost = ""; try { originHost = new URL(req.headers.origin).host; } catch {} if (!host || originHost !== host) return res.status(403).json({ error: "درخواست از مبدأ غیرمجاز رد شد." }); }
  try {
    const session = await getLawyerSession(req, res);
    if (!session) return res.status(401).json({ error: "نشست معتبر نیست یا دسترسی شما غیرفعال است." });
    const id = typeof req.body?.question_id === "string" ? req.body.question_id.trim() : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!/^[a-f0-9]{32}$/.test(id) || message.length < 2 || message.length > 5000)
      return res.status(400).json({ error: "شناسه پرسش و متن پاسخ معتبر نیست." });
    const key = "vy:question:" + id;
    const raw = await redis(["GET", key]);
    if (!raw) return res.status(404).json({ error: "پرسش یافت نشد." });
    let q;
    try { q = JSON.parse(raw); } catch { return res.status(503).json({ error: "اطلاعات پرسش مخدوش است." }); }
    if (!q || q.lawyer_id !== session.lawyer.id) return res.status(403).json({ error: "این پرسش به حساب شما اختصاص ندارد." });
    const reply = { id: crypto.randomBytes(12).toString("hex"), lawyer_id: session.lawyer.id, lawyer_name: session.lawyer.name, message, created_at: new Date().toISOString() };
    q.replies = Array.isArray(q.replies) ? q.replies : [];
    q.replies.push(reply);
    q.status = "answered";
    q.updated_at = reply.created_at;
    await redis(["SET", key, JSON.stringify(q)]);
    await redis(["LPUSH", "vy:lawyer:" + session.lawyer.id + ":audit", JSON.stringify({ action: "reply", question_id: id, at: reply.created_at })]);
    return res.status(200).json({ ok: true, message: "پاسخ ثبت شد." });
  } catch (e) {
    console.error("Lawyer reply error:", e.message);
    return res.status(503).json({ error: "ثبت پاسخ موقتاً ممکن نیست." });
  }
};
