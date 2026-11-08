const { clearUserSession, sameOrigin } = require("../../lib/user-auth");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (!sameOrigin(req)) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    await clearUserSession(req, res);
    return res.status(200).json({ ok: true, message: "با موفقیت خارج شدید." });
  } catch {
    console.error("Public user logout failed");
    return res.status(503).json({ error: "خروج موقتاً ممکن نیست." });
  }
};
