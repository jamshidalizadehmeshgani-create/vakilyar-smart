"use strict";
const crypto = require("crypto");
const { consumeIpRateLimit, redis } = require("./quota");

const COOKIE = "vy_owner_session";
const SESSION_TTL = 12 * 60 * 60;

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
function cookie(value, maxAge) {
  return COOKIE + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}
function getCookie(req) {
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const item = part.trim();
    const index = item.indexOf("=");
    if (index > 0 && item.slice(0, index) === COOKIE) {
      try { return decodeURIComponent(item.slice(index + 1)); } catch { return ""; }
    }
  }
  return "";
}
function sameOrigin(req) {
  const host = String(req.headers?.host || "").toLowerCase();
  let originHost = "";
  try { originHost = new URL(req.headers?.origin || "").host.toLowerCase(); } catch {}
  const fetchSite = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
  return Boolean(host && originHost === host && (!fetchSite || fetchSite === "same-origin"));
}
async function rateLimit(req, res, scope, limit) {
  try {
    const result = await consumeIpRateLimit(req, { scope, limit, windowSeconds: 900 });
    if (result.count > result.limit) {
      res.setHeader("Retry-After", String(result.windowSeconds));
      res.status(429).json({ code: "ADMIN_RATE_LIMITED", error: "تعداد درخواست‌ها بیش از حد مجاز است." });
      return false;
    }
    return true;
  } catch {
    console.error("Admin rate-limit error: rate limiter unavailable");
    res.status(503).json({ code: "ADMIN_RATE_LIMIT_UNAVAILABLE", error: "کنترل امنیتی موقتاً در دسترس نیست." });
    return false;
  }
}
async function loginAdmin(req, res) {
  if (!sameOrigin(req)) {
    res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
    return false;
  }
  if (!await rateLimit(req, res, "admin-login", 8)) return false;
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const configuredUsername = process.env.ADMIN_USERNAME || "";
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || "";
  let credentialsValid = false;

  if (configuredUsername && passwordHash) {
    const parts = passwordHash.split("$");
    if (parts.length === 3 && parts[0] === "scrypt" &&
        /^[a-f0-9]{32,128}$/i.test(parts[1]) &&
        /^[a-f0-9]{128}$/i.test(parts[2]) &&
        username.length <= 190 && password.length >= 12 && password.length <= 1024) {
      const derived = await new Promise((resolve, reject) =>
        crypto.scrypt(password, Buffer.from(parts[1], "hex"), 64, (error, key) =>
          error ? reject(error) : resolve(key)
        )
      );
      credentialsValid = safeEqual(username, configuredUsername) &&
        safeEqual(derived.toString("hex"), parts[2].toLowerCase());
    }
  } else {
    // Temporary bootstrap compatibility until owner credentials are provisioned.
    const expected = process.env.ADMIN_API_KEY;
    const supplied = typeof req.body?.key === "string" ? req.body.key : "";
    credentialsValid = Boolean(expected && safeEqual(supplied, expected));
  }
  if (!credentialsValid) {
    res.status(401).json({ error: "نام کاربری یا رمز عبور مالک صحیح نیست." });
    return false;
  }
  const token = crypto.randomBytes(32).toString("hex");
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  await redis(["SET", "vy:admin:session:" + digest, "owner", "EX", String(SESSION_TTL)]);
  res.setHeader("Set-Cookie", cookie(token, SESSION_TTL));
  return true;
}
async function logoutAdmin(req, res) {
  if (!sameOrigin(req)) {
    res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
    return false;
  }
  const token = getCookie(req);
  if (/^[a-f0-9]{64}$/.test(token)) {
    const digest = crypto.createHash("sha256").update(token).digest("hex");
    await redis(["DEL", "vy:admin:session:" + digest]);
  }
  res.setHeader("Set-Cookie", cookie("", 0));
  return true;
}
async function authorizeAdmin(req, res) {
  if (!sameOrigin(req)) {
    res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
    return false;
  }
  if (!await rateLimit(req, res, "admin", 30)) return false;
  const token = getCookie(req);
  if (/^[a-f0-9]{64}$/.test(token)) {
    const digest = crypto.createHash("sha256").update(token).digest("hex");
    const session = await redis(["GET", "vy:admin:session:" + digest]);
    if (session === "owner") return true;
  }
  res.status(401).json({ error: "نشست مالک معتبر نیست؛ دوباره وارد شوید." });
  return false;
}
module.exports = { authorizeAdmin, loginAdmin, logoutAdmin, SESSION_TTL, sameOrigin };
