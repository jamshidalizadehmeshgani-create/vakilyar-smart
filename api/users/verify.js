const { hash, redis } = require("../../lib/user-auth");
const { sendWelcomeEmail } = require("../../lib/email");
const { REFERRAL_REWARD, REFERRAL_MAX_REWARDS } = require("../../lib/referrals");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).send("روش درخواست معتبر نیست."); }
  const token = typeof req.query?.token === "string" ? req.query.token : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).send("پیوند تأیید معتبر نیست.");
  try {
    const tokenKey = "vy:user:verify:" + hash(token);
    const uid = await redis(["GET", tokenKey]);
    if (typeof uid !== "string" || !/^[a-f0-9]{48}$/.test(uid)) return res.status(410).send("پیوند تأیید منقضی یا قبلاً استفاده شده است.");
    const accountKey = "vy:user:account:" + uid;
    const raw = await redis(["GET", accountKey]);
    if (!raw) return res.status(404).send("حساب کاربری یافت نشد.");
    const account = JSON.parse(raw);
    if (!account || account.uid !== uid) return res.status(400).send("اطلاعات حساب معتبر نیست.");
    const verifiedAt = new Date().toISOString();
    const inviterUid = typeof account.referred_by_uid === "string" &&
      /^[a-f0-9]{48}$/.test(account.referred_by_uid) && account.referred_by_uid !== uid
      ? account.referred_by_uid : "";
    const inviterKey = "vy:user:account:" + (inviterUid || "none");
    const inviterCreditsKey = "vy:user:" + (inviterUid || "none") + ":credits";
    const rewardClaimKey = "vy:referral:rewarded:" + uid;
    const initialCredits = Number(process.env.FREE_CREDITS_INITIAL || 1000);
    const script = "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; local raw=redis.call('GET',KEYS[2]); if not raw then return -1 end; local ok,account=pcall(cjson.decode,raw); if not ok or type(account)~='table' or account.uid~=ARGV[1] then return -1 end; if account.email_verified~=true then account.email_verified=true; account.email_verified_at=ARGV[2]; redis.call('SET',KEYS[2],cjson.encode(account)); end; redis.call('DEL',KEYS[1]); local rewarded=0; if ARGV[3]~='' and account.referred_by_uid==ARGV[3] and redis.call('EXISTS',KEYS[5])==0 then local inviterRaw=redis.call('GET',KEYS[3]); if inviterRaw then local okR,inviter=pcall(cjson.decode,inviterRaw); if okR and type(inviter)=='table' and inviter.uid==ARGV[3] and inviter.email_verified==true then local count=tonumber(inviter.referral_successful_count or 0); if count<tonumber(ARGV[6]) then local balance=redis.call('GET',KEYS[4]); if not balance then redis.call('SET',KEYS[4],ARGV[5]); end; redis.call('INCRBY',KEYS[4],ARGV[4]); inviter.referral_successful_count=count+1; inviter.referral_credits_earned=tonumber(inviter.referral_credits_earned or 0)+tonumber(ARGV[4]); redis.call('SET',KEYS[3],cjson.encode(inviter)); redis.call('SET',KEYS[5],'1'); rewarded=1; else redis.call('SET',KEYS[5],'cap'); end; end; end; end; if rewarded==1 then return 2 end; return 1";
    const updated = Number(await redis([
      "EVAL", script, "5", tokenKey, accountKey, inviterKey, inviterCreditsKey, rewardClaimKey,
      uid, verifiedAt, inviterUid, String(REFERRAL_REWARD), String(initialCredits), String(REFERRAL_MAX_REWARDS)
    ]));
    if (updated === 0) return res.status(410).send("پیوند تأیید دیگر معتبر نیست.");
    if (updated < 0) return res.status(404).send("حساب کاربری یافت نشد.");
    const referralRewarded = updated === 2;
    const welcome = await sendWelcomeEmail({
      to: account.email,
      name: account.first_name + " " + account.last_name,
      role: "کاربر",
      loginUrl: (process.env.APP_BASE_URL || "https://vakilyar-smart.vercel.app").replace(/\/$/, "") + "/user-login.html",
      details: [["نام", account.first_name + " " + account.last_name], ["ایمیل", account.email], ["نوع حساب", "کاربر وکیل‌یار"]],
      features: ["ثبت و پیگیری پرسش‌های حقوقی", "مشاهده پاسخ وکیل در پرونده شخصی", "حفظ سابقه و اعتبار حساب در ورودهای بعدی"]
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>تأیید ایمیل وکیل‌یار</title><body style="font-family:Tahoma;background:#f5f3ee;color:#14233f;padding:30px;text-align:center"><main style="max-width:560px;margin:40px auto;background:white;padding:28px;border-radius:14px"><h1>ایمیل شما تأیید شد</h1><p>حساب وکیل‌یار با موفقیت فعال شد. اکنون می‌توانید وارد حساب خود شوید.</p><p><a style="display:inline-block;background:#c9a45c;color:#14233f;padding:12px 22px;border-radius:8px;text-decoration:none" href="/user-login.html">ورود به حساب کاربری</a></p><p style="font-size:13px;color:#667085">' + (welcome.sent ? "ایمیل خوشامدگویی نیز برای شما ارسال شد." : "حساب فعال است؛ ارسال ایمیل خوشامدگویی در حال حاضر در دسترس نیست.") + (referralRewarded ? " با این ثبت‌نام، ۲۵۰ اعتبار رایگان به معرف شما افزوده شد." : "") + '</p></main></body></html>');
  } catch {
    console.error("Public user email verification failed");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(503).send("تأیید ایمیل موقتاً ممکن نیست. لطفاً بعداً دوباره تلاش کنید.");
  }
};
