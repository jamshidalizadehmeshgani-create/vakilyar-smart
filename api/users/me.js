const { getUserSessionUid, redis } = require("../../lib/user-auth");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "فقط GET مجاز است." }); }
  try {
    const uid = await getUserSessionUid(req);
    if (!uid) return res.status(401).json({ authenticated: false });
    const raw = await redis(["GET", "vy:user:account:" + uid]);
    if (!raw) return res.status(401).json({ authenticated: false });
    const account = JSON.parse(raw);
    if (!account || account.uid !== uid || account.email_verified !== true) return res.status(401).json({ authenticated: false });
    return res.status(200).json({ authenticated: true, profile: { first_name: account.first_name, last_name: account.last_name, email: account.email, email_verified: true, created_at: account.created_at } });
  } catch {
    console.error("Public user profile lookup failed");
    return res.status(503).json({ error: "دریافت مشخصات حساب موقتاً ممکن نیست." });
  }
};
