const crypto = require("crypto");
const { getAccount, redis } = require("../../lib/quota");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (req.body?.consent !== true) return res.status(400).json({ error: "برای ارسال پرسش به وکیل، رضایت صریح شما لازم است." });
  const host = req.headers.host || "";\n  let originHost = "";\n  try { originHost = new URL(req.headers.origin || "").host; } catch {}\n  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();\n  if (!host || !originHost || originHost !== host || (fetchSite && fetchSite !== "same-origin")) {\n    return res.status(403).json({ error: "مبدأ درخواست معتبر نیست؛ صفحه را تازه‌سازی و دوباره تلاش کنید." });\n  }
  const lawyerId = typeof req.body?.lawyer_id === "string" ? req.body.lawyer_id.trim() : "";
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!/^[a-f0-9]{32}$/.test(lawyerId) || question.length < 5 || question.length > 5000)
    return res.status(400).json({ error: "وکیل و متن پرسش معتبر را انتخاب کنید." });
  try {
    const raw = await redis(["GET", "vy:lawyer:" + lawyerId]);
    if (!raw) return res.status(404).json({ error: "وکیل یافت نشد." });
    let lawyer;
    try { lawyer = JSON.parse(raw); } catch { return res.status(503).json({ error: "اطلاعات وکیل قابل خواندن نیست." }); }
    if (!lawyer || lawyer.id !== lawyerId || lawyer.access !== "active")
      return res.status(403).json({ error: "این وکیل در حال حاضر پرسش جدید نمی‌پذیرد." });
    const account = await getAccount(req, res);
    const limitKey = "vy:user:" + account.uid + ":question-limit";
    const count = Number(await redis(["INCR", limitKey]));
    if (count === 1) await redis(["EXPIRE", limitKey, "86400"]);
    if (count > 5) return res.status(429).json({ error: "سقف ارسال پرسش روزانه (۵ پرسش) رسیده است." });
    const id = crypto.randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const item = { id, lawyer_id: lawyerId, lawyer_name: lawyer.name, user_id: account.uid, question, status: "open", created_at: now, replies: [] };
    const script = "redis.call('SET',KEYS[1],ARGV[1]); redis.call('LPUSH',KEYS[2],ARGV[2]); redis.call('LPUSH',KEYS[3],ARGV[2]); redis.call('LTRIM',KEYS[2],0,499); redis.call('LTRIM',KEYS[3],0,499); return 1";
    await redis(["EVAL", script, "3", "vy:question:" + id, "vy:lawyer:" + lawyerId + ":questions", "vy:user:" + account.uid + ":questions", JSON.stringify(item), id]);
    return res.status(201).json({ ok: true, question_id: id, message: "پرسش برای وکیل منتخب ارسال شد." });
  } catch (e) {
    console.error("Question create error:", e.message);
    return res.status(503).json({ error: "ارسال پرسش موقتاً ممکن نیست." });
  }
};
