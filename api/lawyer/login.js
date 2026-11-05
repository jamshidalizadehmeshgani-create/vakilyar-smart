const crypto = require("crypto");
const { redis, COOKIE, SESSION_SECONDS, cookieHeader, hashToken } = require("../../lib/lawyer-auth");

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
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 200)
    return res.status(400).json({ error: "ایمیل یا رمز عبور معتبر نیست." });
  try {
    const rateId = crypto.createHash("sha256").update(email).digest("hex");
    const rateKey = "vy:lawyer:login-attempts:" + rateId;
    const attempts = Number(await redis(["INCR", rateKey]));
    if (attempts === 1) await redis(["EXPIRE", rateKey, "900"]);
    if (attempts > 8) return res.status(429).json({ error: "تلاش‌های ورود بیش از حد است؛ ۱۵ دقیقه بعد دوباره تلاش کنید." });
    const emailKey = "vy:lawyer:email:" + rateId;
    const id = await redis(["GET", emailKey]);
    const raw = id ? await redis(["GET", "vy:lawyer:" + id]) : null;
    let lawyer = null;
    try { lawyer = raw ? JSON.parse(raw) : null; } catch {}
    const valid = lawyer && lawyer.access === "active" && await verifyPassword(password, lawyer.password_hash);
    if (!valid) return res.status(401).json({ error: "اطلاعات ورود نادرست است یا دسترسی حساب فعال نیست." });
    await redis(["DEL", rateKey]);
    const token = crypto.randomBytes(32).toString("hex");
    await redis(["SET", "vy:lawyer:session:" + hashToken(token), lawyer.id, "EX", String(SESSION_SECONDS)]);
    res.setHeader("Set-Cookie", cookieHeader(token, SESSION_SECONDS));
    return res.status(200).json({ ok: true, lawyer: { id: lawyer.id, name: lawyer.name, email: lawyer.email }, message: "ورود موفق بود." });
  } catch (error) {
    console.error("Lawyer login error:", error.message);
    return res.status(503).json({ error: "سامانه ورود موقتاً در دسترس نیست." });
  }
};
