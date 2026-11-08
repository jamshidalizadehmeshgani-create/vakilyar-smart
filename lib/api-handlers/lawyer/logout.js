const { redis, cookieValue, cookieHeader, hashToken, COOKIE } = require("../../../lib/lawyer-auth");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  const host = req.headers.host || "";
  let originHost = "";
  try { originHost = new URL(req.headers.origin || "").host; } catch {}
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (!host || !originHost || originHost !== host || (fetchSite && fetchSite !== "same-origin"))
    return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });

  const token = cookieValue(req, COOKIE);
  // Clear the browser cookie even if Redis is temporarily unavailable.
  res.setHeader("Set-Cookie", cookieHeader("", 0));
  if (!token) return res.status(200).json({ ok: true, message: "از حساب خارج شدید." });

  try {
    const sessionKey = "vy:lawyer:session:" + hashToken(token);
    const script = "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; local id=string.match(v,'^([a-f0-9]+):%d+$') or string.match(v,'^([a-f0-9]+)$'); redis.call('DEL',KEYS[1]); if id then redis.call('SREM','vy:lawyer:'..id..':sessions',KEYS[1]); end; return 1";
    await redis(["EVAL", script, "1", sessionKey]);
    return res.status(200).json({ ok: true, message: "از حساب خارج شدید." });
  } catch (error) {
    console.error("Lawyer logout error:");
    return res.status(503).json({ error: "نشست از مرورگر پاک شد؛ پاک‌سازی سمت سرور موقتاً کامل نشد." });
  }
};
