const { consumeIpRateLimit, consumeAccountRateLimit } = require("../../lib/quota");
const { validEmail, getUserByEmail, issuePasswordReset, discardPasswordResetToken, sameOrigin } = require("../../lib/user-auth");
const { sendUserPasswordResetEmail } = require("../../lib/email");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (!sameOrigin(req)) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    const rate = await consumeIpRateLimit(req, { scope: "user-password-reset-request", limit: 3, windowSeconds: 3600 });
    if (rate.count > rate.limit) return res.status(429).json({ error: "تعداد درخواست‌ها بیش از حد مجاز است؛ بعداً دوباره تلاش کنید." });
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!validEmail(email)) return res.status(400).json({ error: "ایمیل معتبر وارد کنید." });
    const account = await getUserByEmail(email);
    if (account && account.email_verified === true) {
      const accountRate = await consumeAccountRateLimit(account.uid, { scope: "user-password-reset-account", limit: 3, windowSeconds: 3600 });
      if (accountRate.count > accountRate.limit) {
        return res.status(200).json({ ok: true, message: "اگر حساب فعالی با این ایمیل وجود داشته باشد، در صورت فعال‌بودن سرویس ایمیل، پیوند بازیابی ارسال خواهد شد." });
      }
      const token = await issuePasswordReset(account);
      if (token) {
        const delivery = await sendUserPasswordResetEmail({ to: account.email, name: account.first_name, token });
        if (!delivery.sent) await discardPasswordResetToken(token, account.uid);
      }
    }
    return res.status(200).json({
      ok: true,
      message: "اگر حساب فعالی با این ایمیل وجود داشته باشد، در صورت فعال‌بودن سرویس ایمیل، پیوند بازیابی ارسال خواهد شد."
    });
  } catch {
    console.error("Public user password reset request failed");
    return res.status(503).json({ error: "درخواست بازیابی موقتاً ممکن نیست. بعداً دوباره تلاش کنید." });
  }
};
