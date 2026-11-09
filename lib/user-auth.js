const crypto = require("crypto");
const { redis } = require("./quota");
const { getAppBaseUrl } = require("./email");

const SESSION_COOKIE = "vy_user_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const EMAIL_TTL_SECONDS = 24 * 60 * 60;

function parseCookies(req) {
  return Object.fromEntries(String(req?.headers?.cookie || "").split(";").map(part => {
    const item = part.trim();
    const index = item.indexOf("=");
    if (index < 1) return ["", ""];
    try { return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))]; }
    catch { return [item.slice(0, index), ""]; }
  }));
}
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function cookie(value, maxAge) {
  return SESSION_COOKIE + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}
function validEmail(value) {
  return typeof value === "string" && value.length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validPassword(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 200;
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => {
    if (error) return reject(error);
    resolve(salt + ":" + key.toString("hex"));
  }));
}
function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return Promise.resolve(false);
  const [salt, expectedHex] = stored.split(":");
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => {
    if (error) return reject(error);
    const expected = Buffer.from(expectedHex, "hex");
    resolve(expected.length === key.length && crypto.timingSafeEqual(expected, key));
  }));
}
async function getUserSessionUid(req) {
  const token = parseCookies(req)[SESSION_COOKIE] || "";
  if (!/^[a-f0-9]{64}$/.test(token)) return "";
  const uid = await redis(["GET", "vy:user:session:" + hash(token)]);
  return typeof uid === "string" && /^[a-f0-9]{48}$/.test(uid) ? uid : "";
}
async function createUserSession(uid, res) {
  const token = crypto.randomBytes(32).toString("hex");
  await redis(["SET", "vy:user:session:" + hash(token), uid, "EX", String(SESSION_SECONDS)]);
  res.setHeader("Set-Cookie", cookie(token, SESSION_SECONDS));
}
async function clearUserSession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE] || "";
  if (/^[a-f0-9]{64}$/.test(token)) await redis(["DEL", "vy:user:session:" + hash(token)]);
  res.setHeader("Set-Cookie", [
    cookie("", 0),
    "vy_uid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  ]);
}
async function getUserByEmail(email) {
  const uid = await redis(["GET", "vy:user:email:" + hash(email)]);
  if (typeof uid !== "string" || !/^[a-f0-9]{48}$/.test(uid)) return null;
  const raw = await redis(["GET", "vy:user:account:" + uid]);
  if (!raw) return null;
  try {
    const account = JSON.parse(raw);
    return account && account.uid === uid ? account : null;
  } catch { return null; }
}
async function sendVerificationEmail({ email, firstName, token }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "").trim();
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };
  const base = getAppBaseUrl();
  const url = base + "/api/users/verify?token=" + encodeURIComponent(token);
  const safe = value => String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const html = '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><body style="font-family:Tahoma,Arial;background:#f5f3ee;color:#14233f;padding:24px"><main style="max-width:600px;margin:auto;background:white;border-radius:14px;overflow:hidden"><header style="background:#14233f;color:#f1d28a;padding:24px;text-align:center"><h1>به وکیل‌یار خوش آمدید</h1></header><section style="padding:24px;line-height:2"><h2>سلام ' + safe(firstName) + ' عزیز</h2><p>از اعتماد شما سپاسگزاریم. برای فعال‌سازی حساب و دسترسی به پرونده پرسش‌های خود، نشانی ایمیل‌تان را تأیید کنید.</p><p style="text-align:center"><a style="display:inline-block;background:#c9a45c;color:#14233f;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold" href="' + safe(url) + '">تأیید ایمیل و فعال‌سازی حساب</a></p><p>این پیوند تا ۲۴ ساعت معتبر است. اگر شما ثبت‌نام نکرده‌اید، این پیام را نادیده بگیرید.</p><p style="font-size:12px;color:#667085">گذرواژه شما هرگز در ایمیل ارسال نمی‌شود.</p></section></main></body></html>';
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: "تأیید ایمیل و فعال‌سازی حساب وکیل‌یار", html }),
      signal: AbortSignal.timeout(8000)
    });
    return response.ok ? { sent: true } : { sent: false, reason: "provider_error" };
  } catch { return { sent: false, reason: "provider_unavailable" }; }
}
async function issueVerification(account, suppliedToken) {
  const token = suppliedToken || crypto.randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid verification token");
  const tokenHash = hash(token);
  await redis(["SET", "vy:user:verify:" + tokenHash, account.uid, "EX", String(EMAIL_TTL_SECONDS)]);
  return sendVerificationEmail({ email: account.email, firstName: account.first_name, token });
}
function sameOrigin(req) {
  const host = req.headers.host || "";
  let originHost = "";
  try { originHost = new URL(req.headers.origin || "").host; } catch {}
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  return Boolean(host && originHost === host && (!fetchSite || fetchSite === "same-origin"));
}
module.exports = {
  SESSION_COOKIE, SESSION_SECONDS, EMAIL_TTL_SECONDS, parseCookies, hash, cookie,
  validEmail, validPassword, hashPassword, verifyPassword, getUserSessionUid,
  createUserSession, clearUserSession, getUserByEmail, issueVerification, sameOrigin, redis
};
