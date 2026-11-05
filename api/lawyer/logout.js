const { redis, cookieValue, cookieHeader, hashToken, COOKIE } = require("../../lib/lawyer-auth");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  try {
    const token = cookieValue(req, COOKIE);
    if (token) await redis(["DEL", "vy:lawyer:session:" + hashToken(token)]);
    res.setHeader("Set-Cookie", cookieHeader("", 0));
    return res.status(200).json({ ok: true, message: "از حساب خارج شدید." });
  } catch (error) {
    console.error("Lawyer logout error:", error.message);
    return res.status(503).json({ error: "خروج امن موقتاً ممکن نیست." });
  }
};
