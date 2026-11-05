const crypto = require("crypto");
const { redis } = require("./quota");
const COOKIE = "vy_lawyer_session";
const SESSION_SECONDS = 8 * 60 * 60;

function cookieValue(req, name) {
  const parts = (req.headers.cookie || "").split(";");
  for (const part of parts) {
    const i = part.trim().indexOf("=");
    if (i > 0 && part.trim().slice(0, i) === name) return decodeURIComponent(part.trim().slice(i + 1));
  }
  return "";
}
function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
async function getLawyerSession(req, res) {
  const token = cookieValue(req, COOKIE);
  if (!token || token.length < 40 || token.length > 200) return null;
  const sessionKey = "vy:lawyer:session:" + hashToken(token);
  const id = await redis(["GET", sessionKey]);
  if (!id || !/^[a-f0-9]{32}$/.test(id)) return null;
  const raw = await redis(["GET", "vy:lawyer:" + id]);
  if (!raw) { await redis(["DEL", sessionKey]); return null; }
  let lawyer;
  try { lawyer = JSON.parse(raw); } catch { await redis(["DEL", sessionKey]); return null; }
  if (!lawyer || lawyer.id !== id || lawyer.access !== "active") {
    await redis(["DEL", sessionKey]);
    if (res) res.setHeader("Set-Cookie", cookieHeader("", 0));
    return null;
  }
  return { lawyer, sessionKey };
}
module.exports = { redis, COOKIE, SESSION_SECONDS, cookieValue, cookieHeader, hashToken, getLawyerSession };
