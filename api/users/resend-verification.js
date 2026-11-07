const { consumeIpRateLimit } = require("../../lib/quota");
const { validEmail, getUserByEmail, issueVerification, sameOrigin } = require("../../lib/user-auth");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (!sameOrigin(req)) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    const rate = await consumeIpRateLimit(req, { scope: "user-resend-verify", limit: 3, windowSeconds: 3600 });
    if (rate.count > rate.limit) return res.status(429).json({ error: "تعداد درخواست‌های ارسال مجدد بیش از حد مجاز است." });
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!validEmail(email)) return res.status(400).json({ error: "ایمیل معتبر وارد کنید." });
    const account = await getUserByEmail(email);
    // Use the same generic response whether the account exists or not.
    if (account && account.email_verified !== true) await issueVerification(account);
    return res.status(200).json({ ok: true, message: "اگر حساب تأییدنشده‌ای با این ایمیل وجود داشته باشد، پیوند تازه ارسال خواهد شد." });
  } catch {
    console.error("Public user verification resend failed");
    return res.status(503).json({ error: "ارسال پیوند تأیید موقتاً ممکن نیست." });
  }
};
