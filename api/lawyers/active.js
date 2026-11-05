const { redis } = require("../../lib/quota");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "فقط GET مجاز است." }); }
  try {
    const ids = await redis(["SMEMBERS", "vy:lawyers:index"]) || [];
    const rows = await Promise.all(ids.map(async id => {
      const raw = await redis(["GET", "vy:lawyer:" + id]);
      if (!raw) return null;
      try {
        const w = JSON.parse(raw);
        return w && w.id === id && w.access === "active" ? { id: w.id, name: w.name } : null;
      } catch { return null; }
    }));
    return res.status(200).json({ ok: true, lawyers: rows.filter(Boolean) });
  } catch (e) {
    console.error("Active lawyers error:", e.message);
    return res.status(503).json({ error: "فهرست وکلا موقتاً در دسترس نیست." });
  }
};
