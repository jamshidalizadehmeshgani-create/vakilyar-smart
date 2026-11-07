const crypto = require("crypto");
const { getAccount, consumeIpRateLimit } = require("../../lib/quota");
const { validEmail, validPassword, hashPassword, hash, issueVerification, sameOrigin, redis } = require("../../lib/user-auth");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (!sameOrigin(req)) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    const rate = await consumeIpRateLimit(req, { scope: "user-register", limit: 5, windowSeconds: 3600 });
    if (rate.count > rate.limit) return res.status(429).json({ error: "تعداد تلاش‌های ثبت‌نام بیش از حد مجاز است." });
    const firstName = typeof req.body?.first_name === "string" ? req.body.first_name.trim() : "";
    const lastName = typeof req.body?.last_name === "string" ? req.body.last_name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body?.password;
    if (firstName.length < 2 || firstName.length > 60 || lastName.length < 2 || lastName.length > 80 || !validEmail(email) || !validPassword(password)) {
      return res.status(400).json({ error: "نام و نام خانوادگی معتبر، ایمیل صحیح و گذرواژه حداقل ۱۰ نویسه‌ای وارد کنید." });
    }
    const accountIdentity = await getAccount(req, res);
    const referralCode = typeof req.body?.referral_code === "string" ? req.body.referral_code.trim().toUpperCase() : "";
    let referredByUid = "";
    if (referralCode) {
      if (!/^[A-Z2-9]{10}$/.test(referralCode)) {
        return res.status(400).json({ error: "کد معرفی معتبر نیست." });
      }
      const referrerUid = await redis(["GET", "vy:referral:code:" + referralCode]);
      if (typeof referrerUid !== "string" || !/^[a-f0-9]{48}$/.test(referrerUid) || referrerUid === accountIdentity.uid) {
        return res.status(400).json({ error: "کد معرفی معتبر نیست یا امکان معرفی خودتان وجود ندارد." });
      }
      const referrerRaw = await redis(["GET", "vy:user:account:" + referrerUid]);
      let referrer;
      try { referrer = referrerRaw ? JSON.parse(referrerRaw) : null; } catch {}
      if (!referrer || referrer.uid !== referrerUid || referrer.email_verified !== true) {
        return res.status(400).json({ error: "کد معرفی دیگر فعال نیست." });
      }
      referredByUid = referrerUid;
    }
    const passwordHash = await hashPassword(password);
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hash(token);
    const account = { uid: accountIdentity.uid, first_name: firstName, last_name: lastName, email, password_hash: passwordHash, email_verified: false, ...(referredByUid ? { referred_by_uid: referredByUid } : {}), created_at: new Date().toISOString() };
    const script = "if redis.call('EXISTS',KEYS[1])==1 then return -1 end; if redis.call('EXISTS',KEYS[2])==1 then return -2 end; redis.call('SET',KEYS[1],ARGV[1]); redis.call('SET',KEYS[2],ARGV[2]); redis.call('SET',KEYS[3],ARGV[3],'EX',ARGV[4]); return 1";
    const created = Number(await redis(["EVAL", script, "3", "vy:user:account:" + account.uid, "vy:user:email:" + hash(email), "vy:user:verify:" + tokenHash, JSON.stringify(account), account.uid, token, "86400"]));
    if (created === -1) return res.status(409).json({ error: "این مرورگر قبلاً به یک حساب متصل شده است. ابتدا وارد همان حساب شوید." });
    if (created === -2) return res.status(409).json({ error: "این ایمیل قبلاً ثبت شده است. وارد حساب شوید یا از بازیابی دسترسی استفاده کنید." });
    if (created !== 1) throw new Error("Unexpected account registration result");
    const delivery = await issueVerification(account, token);
    return res.status(201).json({
      ok: true, email_verification_required: true, email_sent: delivery.sent,
      message: delivery.sent
        ? "ثبت‌نام انجام شد. پیوند تأیید به ایمیل شما ارسال شد؛ پس از تأیید می‌توانید وارد شوید."
        : "اطلاعات حساب ثبت شد، اما ارسال ایمیل هنوز فعال نیست. حساب تا تأیید ایمیل غیرفعال می‌ماند."
    });
  } catch (error) {
    console.error("Public user registration failed");
    return res.status(503).json({ error: "ثبت‌نام موقتاً ممکن نیست. لطفاً کمی بعد تلاش کنید." });
  }
};
