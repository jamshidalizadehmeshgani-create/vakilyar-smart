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
  // Kept as a small primitive for diagnostics and regression tests.
  const script = "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return count";
  return Number(await redis(["EVAL", script, "1", key, "86400"]));
}

async function createQuestionWithDailyLimit({ counterKey, questionKey, lawyerListKey, userListKey, item, id, retentionSeconds, dailyLimit = 5 }) {
  const script = "-- CREATE_OWNED_QUESTION_WITH_DAILY_LIMIT\n" +
    "local count=tonumber(redis.call('GET',KEYS[1]) or '0'); " +
    "if count>=tonumber(ARGV[4]) then return -1 end; " +
    "count=redis.call('INCR',KEYS[1]); " +
    "if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[5]); end; " +
    "redis.call('SET',KEYS[2],ARGV[1],'EX',ARGV[3]); " +
    "redis.call('LPUSH',KEYS[3],ARGV[2]); redis.call('LPUSH',KEYS[4],ARGV[2]); " +
    "redis.call('LTRIM',KEYS[3],0,499); redis.call('LTRIM',KEYS[4],0,499); return count";
  return Number(await redis([
    "EVAL", script, "4", counterKey, questionKey, lawyerListKey, userListKey,
    JSON.stringify(item), id, String(retentionSeconds), String(dailyLimit), "86400"
  ]));
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
    const id = crypto.randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const item = { id, lawyer_id: lawyerId, lawyer_name: lawyer.name, user_id: account.uid, question, status: "open", created_at: now, replies: [] };
    const count = await createQuestionWithDailyLimit({
      counterKey: limitKey,
      questionKey: "vy:question:" + id,
      lawyerListKey: "vy:lawyer:" + lawyerId + ":questions",
      userListKey: "vy:user:" + account.uid + ":questions",
      item, id, retentionSeconds, dailyLimit: 5
    });
    if (count < 0) return res.status(429).json({ error: "سقف ارسال پرسش روزانه (۵ پرسش) رسیده است." });
    return res.status(201).json({ ok: true, question_id: id, message: "پرسش برای وکیل منتخب ارسال شد." });
  } catch (e) {
    console.error("Question create error:", e.message);
    return res.status(503).json({ error: "ارسال پرسش موقتاً ممکن نیست." });
  }
};

module.exports.incrementDailyQuestionCount = incrementDailyQuestionCount;
module.exports.createQuestionWithDailyLimit = createQuestionWithDailyLimit;
module.exports.questionRetentionSeconds = questionRetentionSeconds;
