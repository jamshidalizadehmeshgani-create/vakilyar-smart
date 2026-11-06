const { redis } = require("../lib/quota");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "فقط درخواست GET پذیرفته می‌شود." });
  }

  const configuration = {
    app_secret_present: Boolean(process.env.APP_SECRET),
    redis_url_present: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    redis_token_present: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    ai_api_key_present: Boolean(process.env.AI_API_KEY)
  };

  let redisReady = false;
  if (configuration.redis_url_present && configuration.redis_token_present) {
    try {
      redisReady = (await redis(["PING"])) === "PONG";
    } catch (error) {
      console.error("Health Redis check failed:", error.message);
    }
  }

  const ready = configuration.app_secret_present && redisReady;
  return res.status(ready ? 200 : 503).json({
    ok: ready,
    service: "vakilyar-smart-api",
    version: "0.1.0",
    checks: { ...configuration, redis_connection: redisReady }
  });
};
