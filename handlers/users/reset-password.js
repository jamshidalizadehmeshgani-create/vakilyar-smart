const { consumeIpRateLimit } = require("../../lib/quota");
const { validPassword, hashPassword, resetUserPassword, sameOrigin, cookie } = require("../../lib/user-auth");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (!sameOrigin(req)) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    const rate = await consumeIpRateLimit(req, { scope: "user-password-reset-complete", limit: 5, windowSeconds: 900 });
    if (rate.count > rate.limit) return res.status(429).json({ error: "تلاش‌های تغییر گذرواژه بیش از حد مجاز است." });
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const password = req.body?.password;
    if (!/^[a-f0-9]{64}$/.test(token) || !validPassword(password)) {
      return res.status(400).json({ error: "پیوند بازیابی یا گذرواژه معتبر نیست. گذرواژه باید حداقل ۱۰ نویسه داشته باشد." });
    }
    const passwordHash = await hashPassword(password);
    const uid = await resetUserPassword(token, passwordHash, new Date().toISOString());
    if (!uid) return res.status(410).json({ error: "پیوند بازیابی منقضی شده یا قبلاً استفاده شده است. درخواست پیوند تازه بدهید." });
    res.setHeader("Set-Cookie", [
      cookie("", 0),
      "vy_uid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    ]);
    return res.status(200).json({ ok: true, message: "گذرواژه با موفقیت تغییر کرد. نشست‌های قبلی باطل شدند؛ اکنون با گذرواژه جدید وارد شوید." });
  } catch {
    console.error("Public user password reset failed");
    return res.status(503).json({ error: "تغییر گذرواژه موقتاً ممکن نیست. دوباره تلاش کنید." });
  }
};
