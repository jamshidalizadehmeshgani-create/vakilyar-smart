const { getAccount } = require("../lib/quota");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "فقط درخواست GET پذیرفته می‌شود." });
  }
  try {
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
    console.error("Usage API error:", error.message);
    const missing = [];
    if (!process.env.APP_SECRET) missing.push("APP_SECRET");
    if (!process.env.UPSTASH_REDIS_REST_URL) missing.push("UPSTASH_REDIS_REST_URL");
    if (!process.env.UPSTASH_REDIS_REST_TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
    return res.status(503).json({
      ok: false,
      code: missing.length ? "QUOTA_CONFIGURATION_MISSING" : "QUOTA_STORAGE_UNAVAILABLE",
      missing_configuration: missing,
      storage_diagnostic: missing.length ? null : (/^Redis (?:transport|request) failed \(([A-Z0-9_]{2,40})\)$/.exec(error.message || "")?.[1] || (/^Redis response was invalid \(HTTP_([0-9]{3})\)$/.exec(error.message || "")?.[1] ? "INVALID_RESPONSE_HTTP_" + /^Redis response was invalid \(HTTP_([0-9]{3})\)$/.exec(error.message || "")[1] : (error.message === "Redis command failed" ? "REDIS_COMMAND_FAILED" : error.message === "Redis response was invalid" ? "REDIS_INVALID_RESPONSE" : /^[A-Za-z]+$/.test(error.name || "") ? "UNEXPECTED_" + error.name.toUpperCase() : "REDIS_INTERNAL_ERROR"))),
      storage_detail: missing.length ? null : String(error.message || "Unknown error")
        .replace(/https?:\/\/[^\s"'`]+/gi, "[url]")
        .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
        .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
        .slice(0, 120),
      error: missing.length
        ? "تنظیمات لازم برای سهمیه‌بندی در محیط استقرار کامل نیست."
        : "پایگاه داده سهمیه در دسترس نیست؛ اتصال Upstash را بررسی کنید."
    });
  }
};
