const crypto = require("crypto");
const { consumeIpRateLimit } = require("../../lib/quota");
const { validEmail, verifyPassword, getUserByEmail, createUserSession, sameOrigin, redis } = require("../../lib/user-auth");
const DUMMY_HASH = crypto.scryptSync("never-valid-public-user-password", "0123456789abcdef0123456789abcdef", 64).toString("hex");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (!sameOrigin(req)) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    const rate = await consumeIpRateLimit(req, { scope: "user-login", limit: 20, windowSeconds: 900 });
    if (rate.count > rate.limit) return res.status(429).json({ error: "تلاش‌های ورود بیش از حد مجاز است؛ ۱۵ دقیقه بعد دوباره تلاش کنید." });
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!validEmail(email) || password.length < 1 || password.length > 200) return res.status(400).json({ error: "ایمیل یا گذرواژه معتبر نیست." });
    const account = await getUserByEmail(email);
    const stored = account?.password_hash || "0123456789abcdef0123456789abcdef:" + DUMMY_HASH;
    const matches = await verifyPassword(password, stored);
    if (!account || !matches) return res.status(401).json({ error: "ایمیل یا گذرواژه نادرست است." });
    if (account.email_verified !== true) return res.status(403).json({ code: "EMAIL_NOT_VERIFIED", error: "ابتدا ایمیل خود را تأیید کنید." });
    await createUserSession(account.uid, res);
    return res.status(200).json({ ok: true, profile: { first_name: account.first_name, last_name: account.last_name, email: account.email }, message: "ورود موفق بود." });
  } catch {
    console.error("Public user login failed");
    return res.status(503).json({ error: "ورود موقتاً ممکن نیست." });
  }
};
