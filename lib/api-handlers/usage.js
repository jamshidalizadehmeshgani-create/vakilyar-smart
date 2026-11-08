const { getAccount, consumeIpRateLimit } = require("../../lib/quota");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "فقط درخواست GET پذیرفته می‌شود." });
  }
  try {
    const ipLimit = await consumeIpRateLimit(req, { scope: "usage", limit: 120, windowSeconds: 900 });
    if (ipLimit.count > ipLimit.limit) {
      res.setHeader("Retry-After", String(ipLimit.windowSeconds));
      return res.status(429).json({ code: "USAGE_RATE_LIMITED", error: "درخواست‌های بررسی سهمیه از این اتصال بیش از حد مجاز است." });
    }
    const account = await getAccount(req, res);
    return res.status(200).json({
      ok: true,
      account_id: account.uid,
      plan: account.isPro ? "pro" : "free",
      legal_scope_default: "iran",
      credits_remaining: (account.isPro || account.isUnlimited) ? null : account.credits,
      unlimited: account.isUnlimited,
      free_credits_initial: Number(process.env.FREE_CREDITS_INITIAL || 1000)
    });
  } catch (error) {
    console.error("Usage API error:");
    const missing = [];
    if (!process.env.APP_SECRET) missing.push("APP_SECRET");
    if (!process.env.UPSTASH_REDIS_REST_URL) missing.push("UPSTASH_REDIS_REST_URL");
    if (!process.env.UPSTASH_REDIS_REST_TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
    return res.status(503).json({
      ok: false,
      code: missing.length ? "QUOTA_CONFIGURATION_MISSING" : "QUOTA_STORAGE_UNAVAILABLE",
      missing_configuration: missing,
      storage_diagnostic: missing.length ? null : "REDIS_STORAGE_ERROR",
      error: missing.length
        ? "تنظیمات لازم برای سهمیه‌بندی در محیط استقرار کامل نیست."
        : "پایگاه داده سهمیه در دسترس نیست؛ اتصال Upstash را بررسی کنید."
    });
  }
};
