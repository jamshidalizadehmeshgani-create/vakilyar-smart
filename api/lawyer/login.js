const crypto = require("crypto");
const net = require("net");
const DUMMY_PASSWORD_HASH = crypto.scryptSync("vakilyar-dummy-password-never-valid", "0123456789abcdef0123456789abcdef", 64).toString("hex");
const { redis, COOKIE, SESSION_SECONDS, cookieHeader, hashToken } = require("../../lib/lawyer-auth");

async function incrementLoginAttempts(key, ttlSeconds = 900) {
  if (typeof key !== "string" || !key || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new Error("Invalid login rate-limit configuration");
  }
  const script = "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return count";
  return Number(await redis(["EVAL", script, "1", key, String(ttlSeconds)]));
}

function loginAttemptKey(email, ip, secret) {
  if (typeof email !== "string" || !email || typeof ip !== "string" || !net.isIP(ip) || typeof secret !== "string" || !secret) {
    throw new Error("Invalid login rate-limit identity");
  }
  const digest = crypto.createHmac("sha256", secret).update(email + "\\n" + ip).digest("hex");
  return "vy:lawyer:login-pair-attempts:" + digest;
}

function trustedClientIp(req) {
  const ip = String(req?.headers?.["x-real-ip"] || "").trim();
  return net.isIP(ip) ? ip : "";
}

function passwordHashForVerification(lawyer) {
  const stored = lawyer?.password_hash;
  return typeof stored === "string" && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)
    ? stored
    : "0123456789abcdef0123456789abcdef:" + DUMMY_PASSWORD_HASH;
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
    const secret = process.env.APP_SECRET;
    const ip = trustedClientIp(req);
    if (!secret || !ip) {
      return res.status(503).json({ code: "LOGIN_RATE_LIMIT_UNAVAILABLE", error: "کنترل امن تلاش‌های ورود موقتاً در دسترس نیست." });
    }
    const ipId = crypto.createHmac("sha256", secret).update(ip).digest("hex");
    const ipKey = "vy:lawyer:login-ip-attempts:" + ipId;
    const ipAttempts = await incrementLoginAttempts(ipKey);
    if (ipAttempts > 30) return res.status(429).json({ error: "تلاش‌های ورود از این اتصال بیش از حد است؛ ۱۵ دقیقه بعد دوباره تلاش کنید." });
    // Scope the account-specific throttle to this IP as well, preventing one
    // remote client from locking a lawyer's account for every other client.
    const pairKey = loginAttemptKey(email, ip, secret);
    const attempts = await incrementLoginAttempts(pairKey);
    if (attempts > 8) return res.status(429).json({ error: "تلاش‌های ورود برای این حساب از این اتصال بیش از حد است؛ ۱۵ دقیقه بعد دوباره تلاش کنید." });
    const rateId = crypto.createHash("sha256").update(email).digest("hex");
    const emailKey = "vy:lawyer:email:" + rateId;
    const id = await redis(["GET", emailKey]);
    const raw = id ? await redis(["GET", "vy:lawyer:" + id]) : null;
    let lawyer = null;
    try { lawyer = raw ? JSON.parse(raw) : null; } catch {}
    // Always perform one scrypt verification, even when the email is unknown or the stored hash is malformed.
    // This reduces account-enumeration timing differences without changing the public error response.
    const storedHash = passwordHashForVerification(lawyer);
    const passwordMatches = await verifyPassword(password, storedHash);
    const valid = Boolean(lawyer && lawyer.access === "active" && passwordMatches);
    if (!valid) return res.status(401).json({ error: "اطلاعات ورود نادرست است یا دسترسی حساب فعال نیست." });
    await redis(["DEL", pairKey]);
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
module.exports.loginAttemptKey = loginAttemptKey;
module.exports.trustedClientIp = trustedClientIp;
module.exports.passwordHashForVerification = passwordHashForVerification;
