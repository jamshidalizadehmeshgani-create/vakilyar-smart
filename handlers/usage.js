const { getAccount, consumeIpRateLimit } = require("../lib/quota");
const { shouldUseValkey, getValkeyDiagnostic } = require("../lib/valkey");

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
    const usingValkey = shouldUseValkey(process.env);
    const backend = usingValkey ? "valkey" : "upstash";
    const missing = [];
    if (!process.env.APP_SECRET) missing.push("APP_SECRET");
    if (usingValkey) {
      if (!process.env.VALKEY_URL) missing.push("VALKEY_URL");
    } else {
      if (!process.env.UPSTASH_REDIS_REST_URL) missing.push("UPSTASH_REDIS_REST_URL");
      if (!process.env.UPSTASH_REDIS_REST_TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
    }

    // Expose only a bounded, allowlisted diagnostic code. Never return raw
    // Redis/ioredis messages because they may contain connection details.
    const rawCode = String(error && error.code || "").toUpperCase();
    const safeStorageCodes = new Set([
      "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
      "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "CERT_HAS_EXPIRED",
      "ERR_TLS_CERT_ALTNAME_INVALID", "CLIENT_IP_UNAVAILABLE"
    ]);
    const safeCode = safeStorageCodes.has(rawCode) ? rawCode : "REDIS_STORAGE_ERROR";
    const diagnostic = missing.length ? null : usingValkey ? getValkeyDiagnostic(error) : safeCode;
    console.error("Usage API unavailable", { backend, diagnostic: diagnostic || "CONFIGURATION_MISSING" });

    return res.status(503).json({
      ok: false,
      code: missing.length ? "QUOTA_CONFIGURATION_MISSING" : "QUOTA_STORAGE_UNAVAILABLE",
      storage_backend: backend,
      missing_configuration: missing,
      storage_diagnostic: diagnostic,
      error: missing.length
        ? "تنظیمات لازم برای سهمیه‌بندی در محیط استقرار کامل نیست."
        : backend === "valkey"
          ? "پایگاه داده سهمیه آزمایشی (Valkey) در دسترس نیست؛ اتصال محیط آزمایشی را بررسی کنید."
          : "پایگاه داده سهمیه در دسترس نیست؛ اتصال Upstash را بررسی کنید."
    });
  }
};
