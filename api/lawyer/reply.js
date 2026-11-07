const crypto = require("crypto");
const { getLawyerSession, redis } = require("../../lib/lawyer-auth");
const { consumeIpRateLimit } = require("../../lib/quota");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  const host = req.headers.host || "";
  let originHost = "";
  try { originHost = new URL(req.headers.origin || "").host; } catch {}
  if (!host || !originHost || originHost !== host) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    const limit = await consumeIpRateLimit(req, { scope: "lawyer-reply", limit: 40, windowSeconds: 900 });
    if (limit.count > limit.limit) {
      res.setHeader("Retry-After", String(limit.windowSeconds));
      return res.status(429).json({ code: "LAWYER_REPLY_RATE_LIMITED", error: "تعداد پاسخ‌های ارسالی از این اتصال بیش از حد مجاز است." });
    }
    const session = await getLawyerSession(req, res);
    if (!session) return res.status(401).json({ error: "نشست معتبر نیست یا دسترسی شما غیرفعال است." });
    const id = typeof req.body?.question_id === "string" ? req.body.question_id.trim() : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const requestId = typeof req.body?.request_id === "string" ? req.body.request_id.trim() : "";
    if (!/^[a-f0-9]{32}$/.test(id) || message.length < 2 || message.length > 5000 || !/^[a-f0-9]{32}$/.test(requestId))
      return res.status(400).json({ error: "شناسه پرسش، شناسه عملیات و متن پاسخ معتبر نیست." });
    const at = new Date().toISOString();
    const reply = { id: crypto.randomBytes(12).toString("hex"), lawyer_id: session.lawyer.id, lawyer_name: session.lawyer.name, message, created_at: at };
    const audit = { action: "reply", question_id: id, lawyer_id: session.lawyer.id, at };
    const fingerprint = crypto.createHash("sha256").update(id + "\\n" + message).digest("hex");
    const idempotencyKey = "vy:lawyer:reply:" + session.lawyer.id + ":" + requestId;
    const script = "-- VY_LAWYER_REPLY_IDEMPOTENT\\nlocal prior=redis.call('GET',KEYS[3]); if prior then local prefix=ARGV[5]..'|'; if string.sub(prior,1,string.len(prefix))~=prefix then return -4 end; return 2 end; local raw=redis.call('GET',KEYS[1]); if not raw then return -1 end; local ok,q=pcall(cjson.decode,raw); if not ok or type(q)~='table' then return -2 end; if q.lawyer_id~=ARGV[1] then return -3 end; q.replies=q.replies or {}; table.insert(q.replies,cjson.decode(ARGV[2])); q.status='answered'; q.updated_at=ARGV[3]; redis.call('SET',KEYS[1],cjson.encode(q),'KEEPTTL'); redis.call('LPUSH',KEYS[2],ARGV[4]); redis.call('LTRIM',KEYS[2],0,499); redis.call('SET',KEYS[3],ARGV[5]..'|'..ARGV[6],'EX',ARGV[7]); return 1";
    const saved = Number(await redis(["EVAL", script, "3", "vy:question:" + id, "vy:lawyer:" + session.lawyer.id + ":audit", idempotencyKey, session.lawyer.id, JSON.stringify(reply), at, JSON.stringify(audit), fingerprint, reply.id, "604800"]));
    if (saved === -1) return res.status(404).json({ error: "پرسش یافت نشد." });
    if (saved === -3) return res.status(403).json({ error: "این پرسش به حساب شما اختصاص ندارد." });
    if (saved === -4) return res.status(409).json({ error: "شناسه این عملیات با متن یا پرسش دیگری استفاده شده است." });
    if (saved === 2) return res.status(200).json({ ok: true, duplicate: true, message: "این پاسخ قبلاً ثبت شده بود؛ پاسخ تکراری ایجاد نشد." });
    if (saved !== 1) return res.status(503).json({ error: "ساختار پرسش قابل پردازش نیست." });
    return res.status(200).json({ ok: true, duplicate: false, message: "پاسخ ثبت شد." });
  } catch (e) {
    console.error("Lawyer reply error:", e.message);
    return res.status(503).json({ error: "ثبت پاسخ موقتاً ممکن نیست." });
  }
};
