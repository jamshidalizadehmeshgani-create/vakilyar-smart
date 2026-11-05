const crypto = require("crypto");

const COOKIE = "vy_uid";
const INITIAL_CREDITS = Number(process.env.FREE_CREDITS_INITIAL || 1000);

function getUid(req, res) {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not configured");
  const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map(v => {
    const i = v.trim().indexOf("=");
    return i < 0 ? ["", ""] : [v.trim().slice(0, i), decodeURIComponent(v.trim().slice(i + 1))];
  }));
  const token = cookies[COOKIE];
  if (token) {
    const [uid, signature] = token.split(".");
    if (uid && signature) {
      const expected = crypto.createHmac("sha256", secret).update(uid).digest("base64url");
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return uid;
    }
  }
  const uid = crypto.randomBytes(24).toString("hex");
  const signature = crypto.createHmac("sha256", secret).update(uid).digest("base64url");
  res.setHeader("Set-Cookie", `${COOKIE}=${uid}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);
  return uid;
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Upstash Redis is not configured");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error("Redis request failed");
  return data.result;
}

async function getAccount(req, res) {
  const uid = getUid(req, res);
  const key = `vy:user:${uid}:credits`;
  const initScript = "local v=redis.call('GET',KEYS[1]); if not v then redis.call('SET',KEYS[1],ARGV[1]); return tonumber(ARGV[1]); end; return tonumber(v)";
  const credits = Number(await redis(["EVAL", initScript, "1", key, String(INITIAL_CREDITS)]));
  const pro = await redis(["GET", `vy:user:${uid}:pro`]);
  const unlimited = await redis(["GET", `vy:user:${uid}:unlimited`]);
  return { uid, key, credits, isPro: pro === "active", isUnlimited: unlimited === "active" };
}

function classifyRequest(message) {
  if (/قرارداد|مبایعه.?نامه|اجاره.?نامه|فسخ|تعهدنامه|شرط ضمن عقد/i.test(message)) return 100;
  if (/سند|pdf|تصویر|فایل|پیوست|دادخواست|لایحه|متن کامل/i.test(message)) return 150;
  if (message.length > 1200) return 30;
  return 10;
}

async function consume(key, cost) {
  const script = "local v=redis.call('GET',KEYS[1]); if not v then return -2 end; if tonumber(v)<tonumber(ARGV[1]) then return -1 end; return redis.call('DECRBY',KEYS[1],ARGV[1])";
  return Number(await redis(["EVAL", script, "1", key, String(cost)]));
}

async function refund(key, cost) {
  return redis(["INCRBY", key, String(cost)]);
}

module.exports = { getAccount, classifyRequest, consume, refund };
