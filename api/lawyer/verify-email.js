const crypto = require("crypto");
const { redis } = require("../../lib/quota");
const { sendWelcomeEmail, escapeHtml } = require("../../lib/email");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).send("روش درخواست معتبر نیست."); }
  const token = typeof req.query?.token === "string" ? req.query.token : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).send("پیوند تأیید معتبر نیست.");
  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenKey = "vy:lawyer:verify:" + tokenHash;
    const rawId = await redis(["GET", tokenKey]);
    if (typeof rawId !== "string" || !/^[a-f0-9]{32}$/.test(rawId)) {
      return res.status(410).send("این پیوند منقضی شده یا قبلاً استفاده شده است.");
    }
    const lawyerKey = "vy:lawyer:" + rawId;
    const pointerKey = lawyerKey + ":verify-token";
    const verifiedAt = new Date().toISOString();
    const script = "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; if redis.call('GET',KEYS[3])~=ARGV[2] then return 0 end; local raw=redis.call('GET',KEYS[2]); if not raw then return -1 end; local ok,lawyer=pcall(cjson.decode,raw); if not ok or type(lawyer)~='table' or lawyer.id~=ARGV[1] then return -2 end; if lawyer.email_verified==true then return 0 end; lawyer.email_verified=true; lawyer.email_verified_at=ARGV[3]; lawyer.email_verification_token_hash=nil; lawyer.email_verification_created_at=nil; redis.call('SET',KEYS[2],cjson.encode(lawyer)); redis.call('DEL',KEYS[1],KEYS[3]); return 1";
    const result = Number(await redis(["EVAL", script, "3", tokenKey, lawyerKey, pointerKey, rawId, tokenHash, verifiedAt]));
    if (result !== 1) return res.status(result === -1 ? 404 : 410).send("پیوند تأیید معتبر نیست یا قبلاً استفاده شده است.");

    const rawLawyer = await redis(["GET", lawyerKey]);
    const lawyer = JSON.parse(rawLawyer);
    let welcome = { sent: false, reason: "not_applicable" };
    if (lawyer.access === "active" && lawyer.password_hash) {
      const welcomeKey = lawyerKey + ":welcome-email";
      const claimed = await redis(["SET", welcomeKey, "sending", "NX", "EX", "120"]);
      if (claimed === "OK") {
        welcome = await sendWelcomeEmail({
          to: lawyer.email, name: lawyer.name, role: "وکیل همکار",
          loginUrl: (process.env.APP_BASE_URL || "https://vakilyar-smart.vercel.app").replace(/\/$/, "") + "/lawyer-login.html",
          details: [
            ["نام و نام خانوادگی", lawyer.name],
            ["ایمیل حساب", lawyer.email],
            ["شماره پروانه", lawyer.license_number || "ثبت نشده"],
            ["نوع حساب", "پنل اختصاصی وکیل"]
          ],
          features: [
            "ورود امن به پنل اختصاصی وکیل",
            "مشاهده پرسش‌های ارجاع‌شده",
            "ارسال پاسخ و پیگیری گفت‌وگو با کاربران"
          ]
        });
        if (welcome.sent) await redis(["SET", welcomeKey, "sent", "EX", "315360000"]);
        else await redis(["DEL", welcomeKey]);
      } else {
        const state = await redis(["GET", welcomeKey]);
        welcome = { sent: state === "sent", reason: state === "sent" ? "already_sent" : "in_progress" };
      }
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>تأیید ایمیل وکیل‌یار</title><body style="font-family:Tahoma;background:#f5f3ee;color:#14233f;padding:30px;text-align:center"><main style="max-width:560px;margin:40px auto;background:white;padding:28px;border-radius:14px"><h1>ایمیل شما با موفقیت تأیید شد</h1><p>اکنون مالکیت نشانی ایمیل شما در وکیل‌یار تأیید شده است.</p><p><a style="display:inline-block;background:#c9a45c;color:#14233f;padding:12px 22px;border-radius:8px;text-decoration:none" href="/lawyer-login.html">ورود به پنل وکیل</a></p><p style="font-size:13px;color:#667085">' + (welcome.sent ? "ایمیل خوشامدگویی برای شما ارسال شد." : "در صورت تکمیل فعال‌سازی حساب، اطلاعات ورود از مسیر امن در اختیار شما قرار می‌گیرد.") + '</p></main></body></html>');
  } catch {
    console.error("Lawyer email verification failed");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(503).send("تأیید ایمیل موقتاً ممکن نیست. لطفاً بعداً دوباره تلاش کنید.");
  }
};
