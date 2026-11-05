const crypto = require("crypto");
const { redis } = require("../lib/quota");

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

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "فقط درخواست POST پذیرفته می‌شود." });
  }

  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || !safeEqual(req.headers.authorization?.replace(/^Bearer\s+/i, ""), adminKey)) {
    return res.status(401).json({ error: "دسترسی مدیر تأیید نشد." });
  }

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
    const grantScript = "local v=redis.call('GET',KEYS[1]); if not v then v=ARGV[1]; redis.call('SET',KEYS[1],v); end; return redis.call('INCRBY',KEYS[1],ARGV[2])";
    const balance = Number(await redis(["EVAL", grantScript, "1", key, String(initialCredits), String(amount)]));
    const audited = await recordAudit({ action: "gift_credits", user_id: userId, amount, at: new Date().toISOString() });
    return res.status(200).json({ ok: true, audit_warning: !audited, credits_added: amount, credits_balance: balance, message: audited ? "اعتبار هدیه با موفقیت اضافه شد." : "اعتبار اضافه شد، اما ثبت گزارش ممیزی ناموفق بود." });
  } catch (error) {
    console.error("Admin credit grant error:", error.message);
    return res.status(503).json({ error: "افزودن اعتبار انجام نشد؛ تنظیمات پایگاه داده را بررسی کنید." });
  }
};
