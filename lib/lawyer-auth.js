const crypto = require("crypto");
const { redis } = require("./quota");
const COOKIE = "vy_lawyer_session";
const SESSION_SECONDS = 8 * 60 * 60;

function cookieValue(req, name) {
  const parts = (req.headers.cookie || "").split(";");
  for (const part of parts) {
    const i = part.trim().indexOf("=");
    if (i > 0 && part.trim().slice(0, i) === name) {
      try { return decodeURIComponent(part.trim().slice(i + 1)); }
      catch { return ""; }
    }
  }
  return "";
}
function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
const DELETE_INVALID_SESSION_SCRIPT = `
-- DELETE_INVALID_LAWYER_SESSION
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local id = string.match(raw, "^([a-f0-9]+):%d+$") or string.match(raw, "^([a-f0-9]+)$")
redis.call("DEL", KEYS[1])
if id then redis.call("SREM", "vy:lawyer:" .. id .. ":sessions", KEYS[1]) end
return 1
`;

async function deleteInvalidSession(sessionKey) {
  await redis(["EVAL", DELETE_INVALID_SESSION_SCRIPT, "1", sessionKey]);
}

async function getLawyerSession(req, res) {
  const token = cookieValue(req, COOKIE);
  if (!token || token.length < 40 || token.length > 200) return null;
  const sessionKey = "vy:lawyer:session:" + hashToken(token);
  const sessionValue = await redis(["GET", sessionKey]);
  if (!sessionValue) return null;
  const match = /^([a-f0-9]{32})(?::(\\d+))?$/.exec(sessionValue);
  if (!match) { await deleteInvalidSession(sessionKey); return null; }
  const id = match[1];
  const sessionVersion = match[2] === undefined ? 0 : Number(match[2]);
  const raw = await redis(["GET", "vy:lawyer:" + id]);
  if (!raw) { await deleteInvalidSession(sessionKey); return null; }
  let lawyer;
  try { lawyer = JSON.parse(raw); } catch { await deleteInvalidSession(sessionKey); return null; }
  if (!lawyer || lawyer.id !== id || lawyer.access !== "active" || sessionVersion !== (Number(lawyer.session_version) || 0)) {
    await deleteInvalidSession(sessionKey);
    if (res) res.setHeader("Set-Cookie", cookieHeader("", 0));
    return null;
  }
  return { lawyer, sessionKey };
}
module.exports = { redis, COOKIE, SESSION_SECONDS, cookieValue, cookieHeader, hashToken, getLawyerSession };
