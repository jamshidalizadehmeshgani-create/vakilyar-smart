const crypto = require("crypto");
const { redis } = require("../lib/quota");

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
    const amount = req.body?.credits;
    const key = `vy:user:${userId}:credits`;
    if (unlimited) {
      await redis(["SET", `vy:user:${userId}:unlimited`, "active"]);
      await redis(["LPUSH", "vy:admin:audit", JSON.stringify({ action: "gift_unlimited", user_id: userId, at: new Date().toISOString() })]);
      return res.status(200).json({ ok: true, message: "دسترسی نامحدود برای این کاربر فعال شد." });
    }

    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000000) {
      return res.status(400).json({ error: "مقدار هدیه باید عدد صحیح بین ۱ تا ۱۰٬۰۰۰٬۰۰۰ باشد یا گزینه نامحدود انتخاب شود." });
    }
    const balance = Number(await redis(["INCRBY", key, String(amount)]));
    await redis(["LPUSH", "vy:admin:audit", JSON.stringify({ action: "gift_credits", user_id: userId, amount, at: new Date().toISOString() })]);
    return res.status(200).json({ ok: true, credits_added: amount, credits_balance: balance, message: "اعتبار هدیه با موفقیت اضافه شد." });
  } catch (error) {
    console.error("Admin credit grant error:", error.message);
    return res.status(503).json({ error: "افزودن اعتبار انجام نشد؛ تنظیمات پایگاه داده را بررسی کنید." });
  }
};
