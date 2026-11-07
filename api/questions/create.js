const crypto = require("crypto");
const { getAccount, redis, consumeIpRateLimit } = require("../../lib/quota");
function questionRetentionSeconds(days = process.env.QUESTION_RETENTION_DAYS) {
  const parsed = days === undefined || days === "" ? 90 : Number(days);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3650) {
    throw new Error("QUESTION_RETENTION_DAYS must be an integer between 1 and 3650");
  }
  return parsed * 86400;
}

async function incrementDailyQuestionCount(key) {
  // Increment and set the first-request TTL atomically to avoid a permanent
  // counter if the function stops between INCR and EXPIRE.
  const script = "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return count";
  return Number(await redis(["EVAL", script, "1", key, "86400"]));
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (req.body?.consent !== true) return res.status(400).json({ error: "برای ارسال پرسش به وکیل، رضایت صریح شما لازم است." });
  const host = req.headers.host || "";
  let originHost = "";
  try { originHost = new URL(req.headers.origin || "").host; } catch {}
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (!host || !originHost || originHost !== host || (fetchSite && fetchSite !== "same-origin")) {
    return res.status(403).json({ error: "مبدأ درخواست معتبر نیست؛ صفحه را تازه‌سازی و دوباره تلاش کنید." });
  }
  const lawyerId = typeof req.body?.lawyer_id === "string" ? req.body.lawyer_id.trim() : "";
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!/^[a-f0-9]{32}$/.test(lawyerId) || question.length < 5 || question.length > 5000)
    return res.status(400).json({ error: "وکیل و متن پرسش معتبر را انتخاب کنید." });
  try {
    const ipLimit = await consumeIpRateLimit(req, { scope: "lawyer-question", limit: 10, windowSeconds: 86400 });
    if (ipLimit.count > ipLimit.limit) {
      res.setHeader("Retry-After", String(ipLimit.windowSeconds));
      return res.status(429).json({ error: "سقف ارسال پرسش از این اتصال در بازه ۲۴ ساعته رسیده است." });
    }
    const raw = await redis(["GET", "vy:lawyer:" + lawyerId]);
    if (!raw) return res.status(404).json({ error: "وکیل یافت نشد." });
    let lawyer;
    try { lawyer = JSON.parse(raw); } catch { return res.status(503).json({ error: "اطلاعات وکیل قابل خواندن نیست." }); }
    if (!lawyer || lawyer.id !== lawyerId || lawyer.access !== "active")
      return res.status(403).json({ error: "این وکیل در حال حاضر پرسش جدید نمی‌پذیرد." });
    const account = await getAccount(req, res);
    // Validate retention configuration before mutating the daily quota counter.
    // A bad environment value must fail closed without consuming a user's attempt.
    const retentionSeconds = questionRetentionSeconds();
    const limitKey = "vy:user:" + account.uid + ":question-limit";
    const count = await incrementDailyQuestionCount(limitKey);
    if (count > 5) return res.status(429).json({ error: "سقف ارسال پرسش روزانه (۵ پرسش) رسیده است." });
    const id = crypto.randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const item = { id, lawyer_id: lawyerId, lawyer_name: lawyer.name, user_id: account.uid, question, status: "open", created_at: now, replies: [] };
    const script = "redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[3]); redis.call('LPUSH',KEYS[2],ARGV[2]); redis.call('LPUSH',KEYS[3],ARGV[2]); redis.call('LTRIM',KEYS[2],0,499); redis.call('LTRIM',KEYS[3],0,499); return 1";
    await redis(["EVAL", script, "3", "vy:question:" + id, "vy:lawyer:" + lawyerId + ":questions", "vy:user:" + account.uid + ":questions", JSON.stringify(item), id, String(retentionSeconds)]);
    return res.status(201).json({ ok: true, question_id: id, message: "پرسش برای وکیل منتخب ارسال شد." });
  } catch (e) {
    console.error("Question create error:", e.message);
    return res.status(503).json({ error: "ارسال پرسش موقتاً ممکن نیست." });
  }
};

module.exports.incrementDailyQuestionCount = incrementDailyQuestionCount;
module.exports.questionRetentionSeconds = questionRetentionSeconds;
