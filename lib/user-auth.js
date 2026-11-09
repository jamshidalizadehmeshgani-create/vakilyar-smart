const crypto = require("crypto");
const { redis } = require("./quota");
const { getAppBaseUrl } = require("./email");

const SESSION_COOKIE = "vy_user_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const EMAIL_TTL_SECONDS = 24 * 60 * 60;
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

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
  const sessionKey = "vy:user:session:" + hash(token);
  const value = await redis(["GET", sessionKey]);
  const match = /^([a-f0-9]{48})(?::(\d+))?$/.exec(String(value || ""));
  if (!match) return "";
  const uid = match[1];
  const sessionVersion = match[2] === undefined ? 0 : Number(match[2]);
  const raw = await redis(["GET", "vy:user:account:" + uid]);
  let account;
  try { account = raw ? JSON.parse(raw) : null; } catch {}
  if (!account || account.uid !== uid || sessionVersion !== (Number(account.session_version) || 0)) {
    const cleanup = "local v=redis.call('GET',KEYS[1]); if v then local id=string.match(v,'^([a-f0-9]+):%d+$') or string.match(v,'^([a-f0-9]+)$'); redis.call('DEL',KEYS[1]); if id then redis.call('SREM','vy:user:'..id..':sessions',KEYS[1]); end end; return 1";
    await redis(["EVAL", cleanup, "1", sessionKey]);
    return "";
  }
  return uid;
}
async function createUserSession(uid, res) {
  if (!/^[a-f0-9]{48}$/.test(uid)) throw new Error("Invalid user session identity");
  const token = crypto.randomBytes(32).toString("hex");
  const sessionKey = "vy:user:session:" + hash(token);
  const sessionIndex = "vy:user:" + uid + ":sessions";
  const script = "local raw=redis.call('GET',KEYS[1]); if not raw then return -1 end; local ok,account=pcall(cjson.decode,raw); if not ok or type(account)~='table' or account.uid~=ARGV[1] then return -1 end; local version=tonumber(account.session_version) or 0; local value=ARGV[1]..':'..tostring(version); redis.call('SET',KEYS[2],value,'EX',ARGV[3]); redis.call('SADD',KEYS[3],KEYS[2]); redis.call('EXPIRE',KEYS[3],ARGV[3]); return version";
  const created = Number(await redis(["EVAL", script, "3", "vy:user:account:" + uid, sessionKey, sessionIndex, uid, String(SESSION_SECONDS)]));
  if (!Number.isSafeInteger(created) || created < 0) throw new Error("Unable to create user session");
  res.setHeader("Set-Cookie", cookie(token, SESSION_SECONDS));
}
async function clearUserSession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE] || "";
  if (/^[a-f0-9]{64}$/.test(token)) {
    const sessionKey = "vy:user:session:" + hash(token);
    const script = "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; local id=string.match(v,'^([a-f0-9]+):%d+$') or string.match(v,'^([a-f0-9]+)$'); redis.call('DEL',KEYS[1]); if id then redis.call('SREM','vy:user:'..id..':sessions',KEYS[1]); end; return 1";
    await redis(["EVAL", script, "1", sessionKey]);
  }
  res.setHeader("Set-Cookie", [
    cookie("", 0),
    "vy_uid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  ]);
}
async function issuePasswordReset(account, suppliedToken) {
  if (!account || !/^[a-f0-9]{48}$/.test(account.uid)) throw new Error("Invalid password reset account");
  const token = suppliedToken || crypto.randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid password reset token");
  const tokenKey = "vy:user:password-reset:" + hash(token);
  const tokenIndex = "vy:user:" + account.uid + ":password-reset-tokens";
  const script = "if redis.call('EXISTS',KEYS[1])==0 then return 0 end; redis.call('SET',KEYS[2],ARGV[1],'EX',ARGV[2]); redis.call('SADD',KEYS[3],KEYS[2]); redis.call('EXPIRE',KEYS[3],ARGV[2]); return 1";
  const issued = Number(await redis(["EVAL", script, "3", "vy:user:account:" + account.uid, tokenKey, tokenIndex, account.uid, String(PASSWORD_RESET_TTL_SECONDS)]));
  return issued === 1 ? token : "";
}
async function discardPasswordResetToken(token, uid) {
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{48}$/.test(uid)) return;
  const tokenKey = "vy:user:password-reset:" + hash(token);
  const tokenIndex = "vy:user:" + uid + ":password-reset-tokens";
  const script = "redis.call('DEL',KEYS[1]); redis.call('SREM',KEYS[2],KEYS[1]); return 1";
  await redis(["EVAL", script, "2", tokenKey, tokenIndex]);
}
async function resetUserPassword(token, passwordHash, updatedAt) {
  if (!/^[a-f0-9]{64}$/.test(token) || typeof passwordHash !== "string" || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash)) return "";
  const tokenKey = "vy:user:password-reset:" + hash(token);
  const script = "local uid=redis.call('GET',KEYS[1]); if not uid or not string.match(uid,'^[a-f0-9]+$') or string.len(uid)~=48 then return '' end; local accountKey='vy:user:account:'..uid; local raw=redis.call('GET',accountKey); if not raw then return '' end; local ok,account=pcall(cjson.decode,raw); if not ok or type(account)~='table' or account.uid~=uid then return '' end; account.password_hash=ARGV[1]; account.session_version=(tonumber(account.session_version) or 0)+1; account.password_updated_at=ARGV[2]; redis.call('SET',accountKey,cjson.encode(account)); local sessions=redis.call('SMEMBERS','vy:user:'..uid..':sessions'); for _,key in ipairs(sessions) do redis.call('DEL',key) end; redis.call('DEL','vy:user:'..uid..':sessions'); local tokens=redis.call('SMEMBERS','vy:user:'..uid..':password-reset-tokens'); for _,key in ipairs(tokens) do redis.call('DEL',key) end; redis.call('DEL','vy:user:'..uid..':password-reset-tokens'); return uid";
  const result = await redis(["EVAL", script, "1", tokenKey, passwordHash, String(updatedAt || new Date().toISOString())]);
  return typeof result === "string" && /^[a-f0-9]{48}$/.test(result) ? result : "";
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
  SESSION_COOKIE, SESSION_SECONDS, EMAIL_TTL_SECONDS, PASSWORD_RESET_TTL_SECONDS, parseCookies, hash, cookie,
  validEmail, validPassword, hashPassword, verifyPassword, getUserSessionUid,
  createUserSession, clearUserSession, getUserByEmail, issueVerification,
  issuePasswordReset, discardPasswordResetToken, resetUserPassword, sameOrigin, redis
};
