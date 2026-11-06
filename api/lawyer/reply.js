const crypto = require("crypto");
const { getLawyerSession, redis } = require("../../lib/lawyer-auth");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  const host = req.headers.host || "";
  let originHost = "";
  try { originHost = new URL(req.headers.origin || "").host; } catch {}
  if (!host || !originHost || originHost !== host) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    const session = await getLawyerSession(req, res);
    if (!session) return res.status(401).json({ error: "نشست معتبر نیست یا دسترسی شما غیرفعال است." });
    const id = typeof req.body?.question_id === "string" ? req.body.question_id.trim() : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!/^[a-f0-9]{32}$/.test(id) || message.length < 2 || message.length > 5000)
      return res.status(400).json({ error: "شناسه پرسش و متن پاسخ معتبر نیست." });
    const at = new Date().toISOString();
    const reply = { id: crypto.randomBytes(12).toString("hex"), lawyer_id: session.lawyer.id, lawyer_name: session.lawyer.name, message, created_at: at };
    const audit = { action: "reply", question_id: id, lawyer_id: session.lawyer.id, at };
    const script = "local raw=redis.call('GET',KEYS[1]); if not raw then return -1 end; local ok,q=pcall(cjson.decode,raw); if not ok or type(q)~='table' then return -2 end; if q.lawyer_id~=ARGV[1] then return -3 end; q.replies=q.replies or {}; table.insert(q.replies,cjson.decode(ARGV[2])); q.status='answered'; q.updated_at=ARGV[3]; redis.call('SET',KEYS[1],cjson.encode(q),'KEEPTTL'); redis.call('LPUSH',KEYS[2],ARGV[4]); redis.call('LTRIM',KEYS[2],0,499); return 1";
    const saved = Number(await redis(["EVAL", script, "2", "vy:question:" + id, "vy:lawyer:" + session.lawyer.id + ":audit", session.lawyer.id, JSON.stringify(reply), at, JSON.stringify(audit)]));
    if (saved === -1) return res.status(404).json({ error: "پرسش یافت نشد." });
    if (saved === -3) return res.status(403).json({ error: "این پرسش به حساب شما اختصاص ندارد." });
    if (saved !== 1) return res.status(503).json({ error: "ساختار پرسش قابل پردازش نیست." });
    return res.status(200).json({ ok: true, message: "پاسخ ثبت شد." });
  } catch (e) {
    console.error("Lawyer reply error:", e.message);
    return res.status(503).json({ error: "ثبت پاسخ موقتاً ممکن نیست." });
  }
};
