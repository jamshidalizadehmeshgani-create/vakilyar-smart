const { redis, consumeIpRateLimit } = require("../../../lib/quota");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "فقط GET مجاز است." }); }
  try {
    const ipLimit = await consumeIpRateLimit(req, { scope: "lawyers-active", limit: 60, windowSeconds: 900 });
    if (ipLimit.count > ipLimit.limit) {
      res.setHeader("Retry-After", String(ipLimit.windowSeconds));
      return res.status(429).json({ code: "LAWYERS_LIST_RATE_LIMITED", error: "درخواست‌های فهرست وکلا از این اتصال بیش از حد مجاز است." });
    }
    const ids = await redis(["SMEMBERS", "vy:lawyers:index"]) || [];
    const rows = await Promise.all(ids.map(async id => {
      const raw = await redis(["GET", "vy:lawyer:" + id]);
      if (!raw) return null;
      try {
        const w = JSON.parse(raw);
        return w && w.id === id && w.access === "active" && w.email_verified !== false ? { id: w.id, name: w.name } : null;
      } catch { return null; }
    }));
    return res.status(200).json({ ok: true, lawyers: rows.filter(Boolean) });
  } catch (e) {
    console.error("Active lawyers error:");
    return res.status(503).json({ error: "فهرست وکلا موقتاً در دسترس نیست." });
  }
};
