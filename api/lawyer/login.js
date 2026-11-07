const crypto = require("crypto");
const { redis, COOKIE, SESSION_SECONDS, cookieHeader, hashToken } = require("../../lib/lawyer-auth");

async function incrementLoginAttempts(key, ttlSeconds = 900) {
  if (typeof key !== "string" || !key || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new Error("Invalid login rate-limit configuration");
  }
  const script = "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return count";
  return Number(await redis(["EVAL", script, "1", key, String(ttlSeconds)]));
}

function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return Promise.resolve(false);
  const [salt, expectedHex] = stored.split(":");
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => {
    if (err) return reject(err);
    const expected = Buffer.from(expectedHex, "hex");
    resolve(expected.length === key.length && crypto.timingSafeEqual(expected, key));
  }));
}
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  const host = req.headers.host || "";
  let originHost = "";
  try { originHost = new URL(req.headers.origin || "").host; } catch {}
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (!host || !originHost || originHost !== host || (fetchSite && fetchSite !== "same-origin"))
    return res.status(403).json({ error: "مبدأ درخواست معتبر نیست؛ صفحه را تازه‌سازی و دوباره تلاش کنید." });
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 200)
    return res.status(400).json({ error: "ایمیل یا رمز عبور معتبر نیست." });
  try {
    const rateId = crypto.createHash("sha256").update(email).digest("hex");
    const rateKey = "vy:lawyer:login-attempts:" + rateId;
    const attempts = await incrementLoginAttempts(rateKey);
    if (attempts > 8) return res.status(429).json({ error: "تلاش‌های ورود بیش از حد است؛ ۱۵ دقیقه بعد دوباره تلاش کنید." });
    const secret = process.env.APP_SECRET;
    const ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (secret && ip && ip.length <= 100) {
      const ipId = crypto.createHmac("sha256", secret).update(ip).digest("hex");
      const ipKey = "vy:lawyer:login-ip-attempts:" + ipId;
      const ipAttempts = await incrementLoginAttempts(ipKey);
      if (ipAttempts > 30) return res.status(429).json({ error: "تلاش‌های ورود از این اتصال بیش از حد است؛ ۱۵ دقیقه بعد دوباره تلاش کنید." });
    }
    const emailKey = "vy:lawyer:email:" + rateId;
    const id = await redis(["GET", emailKey]);
    const raw = id ? await redis(["GET", "vy:lawyer:" + id]) : null;
    let lawyer = null;
    try { lawyer = raw ? JSON.parse(raw) : null; } catch {}
    const valid = lawyer && lawyer.access === "active" && await verifyPassword(password, lawyer.password_hash);
    if (!valid) return res.status(401).json({ error: "اطلاعات ورود نادرست است یا دسترسی حساب فعال نیست." });
    await redis(["DEL", rateKey]);
    const token = crypto.randomBytes(32).toString("hex");
    const sessionKey = "vy:lawyer:session:" + hashToken(token);
    const sessionIndex = "vy:lawyer:" + lawyer.id + ":sessions";
    const createSessionScript = "redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[3]); redis.call('SADD',KEYS[2],KEYS[1]); redis.call('EXPIRE',KEYS[2],ARGV[3]); return 1";
    await redis(["EVAL", createSessionScript, "2", sessionKey, sessionIndex, lawyer.id + ":" + (Number(lawyer.session_version) || 0), String(SESSION_SECONDS)]);
    res.setHeader("Set-Cookie", cookieHeader(token, SESSION_SECONDS));
    return res.status(200).json({ ok: true, lawyer: { id: lawyer.id, name: lawyer.name, email: lawyer.email }, message: "ورود موفق بود." });
  } catch (error) {
    console.error("Lawyer login error:", error.message);
    return res.status(503).json({ error: "سامانه ورود موقتاً در دسترس نیست." });
  }
};

module.exports.incrementLoginAttempts = incrementLoginAttempts;
