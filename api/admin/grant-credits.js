const { redis } = require("../../lib/quota");
const { authorizeAdmin } = require("../../lib/admin-auth");

async function recordAudit(event) {
  try {
    await redis(["LPUSH", "vy:admin:audit", JSON.stringify(event)]);
    await redis(["LTRIM", "vy:admin:audit", "0", "499"]);
    return true;
  } catch (error) {
    console.error("Admin audit error:", error.message);
    return false;
  }
}


module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "فقط درخواست POST پذیرفته می‌شود." });
  }

  if (!await authorizeAdmin(req, res)) return;

  const userId = typeof req.body?.user_id === "string" ? req.body.user_id.trim() : "";
  if (!/^[a-f0-9]{48}$/.test(userId)) {
    return res.status(400).json({ error: "شناسه کاربر معتبر نیست؛ شناسه را از پنل مصرف اعتبار بردارید." });
  }

  try {
    const unlimited = req.body?.unlimited === true;
    if (req.body?.action === "lookup") {
      const [creditsRaw, unlimitedRaw, proRaw] = await Promise.all([
        redis(["GET", `vy:user:${userId}:credits`]),
        redis(["GET", `vy:user:${userId}:unlimited`]),
        redis(["GET", `vy:user:${userId}:pro`])
      ]);
      return res.status(200).json({
        ok: true,
        action: "lookup",
        user_id: userId,
        credits_balance: creditsRaw === null ? Number(process.env.FREE_CREDITS_INITIAL || 1000) : Number(creditsRaw),
        unlimited: unlimitedRaw === "active",
        pro: proRaw === "active"
      });
    }
    if (req.body?.action === "set_pro") {
      if (typeof req.body?.active !== "boolean") {
        return res.status(400).json({ error: "برای فعال‌سازی یا لغو پرو، مقدار active باید true یا false باشد." });
      }
      const proKey = `vy:user:${userId}:pro`;
      if (req.body.active) {
        await redis(["SET", proKey, "active"]);
      } else {
        await redis(["DEL", proKey]);
      }
      const audited = await recordAudit({
        action: req.body.active ? "activate_pro" : "revoke_pro",
        user_id: userId,
        at: new Date().toISOString()
      });
      return res.status(200).json({
        ok: true,
        action: "set_pro",
        user_id: userId,
        pro: req.body.active,
        audit_warning: !audited,
        message: req.body.active
          ? "وکیل‌یار پرو برای این کاربر فعال شد."
          : "دسترسی وکیل‌یار پرو برای این کاربر لغو شد."
      });
    }
    const amount = req.body?.credits;
    const key = `vy:user:${userId}:credits`;
    if (req.body?.unlimited === false) {
      await redis(["DEL", `vy:user:${userId}:unlimited`]);
      const audited = await recordAudit({ action: "revoke_unlimited", user_id: userId, at: new Date().toISOString() });
      return res.status(200).json({ ok: true, audit_warning: !audited, message: audited ? "دسترسی نامحدود این کاربر لغو شد." : "دسترسی نامحدود لغو شد، اما ثبت گزارش ممیزی ناموفق بود." });
    }
    if (unlimited) {
      await redis(["SET", `vy:user:${userId}:unlimited`, "active"]);
      const audited = await recordAudit({ action: "gift_unlimited", user_id: userId, at: new Date().toISOString() });
      return res.status(200).json({ ok: true, audit_warning: !audited, message: audited ? "دسترسی نامحدود برای این کاربر فعال شد." : "دسترسی نامحدود فعال شد، اما ثبت گزارش ممیزی ناموفق بود." });
    }

    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000000) {
      return res.status(400).json({ error: "مقدار هدیه باید عدد صحیح بین ۱ تا ۱۰٬۰۰۰٬۰۰۰ باشد یا گزینه نامحدود انتخاب شود." });
    }
    const initialCredits = Number(process.env.FREE_CREDITS_INITIAL || 1000);
    if (!Number.isSafeInteger(initialCredits) || initialCredits < 0 || initialCredits > 10000000) {
      throw new Error("FREE_CREDITS_INITIAL must be a safe non-negative integer");
    }
    const requestId = typeof req.body?.request_id === "string" ? req.body.request_id : "";
    if (!/^[a-f0-9]{32}$/.test(requestId)) {
      return res.status(400).json({ error: "شناسه یکتای عملیات اعتبار معتبر نیست؛ صفحه را تازه‌سازی کنید." });
    }
    // The idempotency record and balance mutation happen in one Redis Lua call.
    // A retry with the same ID and payload returns the original result; reusing
    // the ID for a different user or amount is rejected.
    const auditEvent = JSON.stringify({ action: "gift_credits", user_id: userId, amount, at: new Date().toISOString() });
    const grantScript = "-- VY_ADMIN_CREDIT_GRANT_IDEMPOTENT\nlocal prior=redis.call('GET',KEYS[2]); if prior then local prefix=ARGV[3]..'|'; if string.sub(prior,1,string.len(prefix))~=prefix then return {-2,0}; end; return {tonumber(string.sub(prior,string.len(prefix)+1)),0}; end; local v=redis.call('GET',KEYS[1]); if not v then v=ARGV[1]; redis.call('SET',KEYS[1],v); end; local balance=redis.call('INCRBY',KEYS[1],ARGV[2]); redis.call('SET',KEYS[2],ARGV[3]..'|'..tostring(balance),'EX',ARGV[4]); redis.call('LPUSH',KEYS[3],ARGV[5]); redis.call('LTRIM',KEYS[3],'0','499'); return {balance,1}";
    const grantResult = await redis(["EVAL", grantScript, "3", key, `vy:admin:grant:${requestId}`, "vy:admin:audit", String(initialCredits), String(amount), `${userId}:${amount}`, "604800", auditEvent]);
    const balance = Number(grantResult?.[0]);
    const wasApplied = Number(grantResult?.[1]) === 1;
    if (Number(grantResult?.[0]) === -2) {
      return res.status(409).json({ error: "شناسه این عملیات قبلاً با اطلاعات دیگری استفاده شده است." });
    }
    if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("Invalid idempotent credit grant result");
    return res.status(200).json({ ok: true, duplicate: !wasApplied, audit_warning: false, credits_added: wasApplied ? amount : 0, credits_balance: balance, message: wasApplied ? "اعتبار هدیه با موفقیت اضافه شد." : "این عملیات قبلاً انجام شده بود؛ اعتبار دوباره اضافه نشد." });
  } catch (error) {
    console.error("Admin credit grant error:", error.message);
    return res.status(503).json({ error: "افزودن اعتبار انجام نشد؛ تنظیمات پایگاه داده را بررسی کنید." });
  }
};
