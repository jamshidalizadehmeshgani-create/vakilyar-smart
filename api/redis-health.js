const { redis } = require("../lib/quota");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const pong = await redis(["PING"]);
    if (pong !== "PONG") throw new Error("Unexpected Redis response");
    return res.status(200).json({
      ok: true,
      service: "vakilyar-redis",
      connected: true,
      check: "PING",
      message: "اتصال پایگاه داده وکیل‌یار برقرار است."
    });
  } catch (error) {
    console.error("Redis health check failed:", error?.message || "unknown");
    return res.status(503).json({
      ok: false,
      service: "vakilyar-redis",
      connected: false,
      message: "اتصال پایگاه داده برقرار نشد؛ تنظیمات امن سرور باید بررسی شود."
    });
  }
};
