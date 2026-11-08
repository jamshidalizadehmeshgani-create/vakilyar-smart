const crypto = require("crypto");
const { shouldUseValkey, createValkeyClient, executeValkeyCommand } = require("./valkey");

const COOKIE = "vy_uid";
const INITIAL_CREDITS = Number(process.env.FREE_CREDITS_INITIAL || 1000);

function getUid(req, res) {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not configured");
  const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map(v => {
    const i = v.trim().indexOf("=");
    if (i < 0) return ["", ""];
    const name = v.trim().slice(0, i);
    try { return [name, decodeURIComponent(v.trim().slice(i + 1))]; }
    catch { return [name, ""]; }
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

// Preview uses an isolated Aiven Valkey instance. Production deliberately
// remains on Upstash even if VALKEY_URL is accidentally configured there.
let valkeyClient = null;

function classifyRedisFailure(error, backend = "REDIS") {
  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  const message = String(error?.message || "").toUpperCase();
  const signal = code + " " + message;
  const prefix = backend === "VALKEY" ? "VALKEY" : "UPSTASH";
  if (/MODULE_NOT_FOUND|CANNOT FIND MODULE/.test(signal)) return prefix + "_CLIENT_LIBRARY_MISSING";
  if (/MUST USE REDISS|REDISS:\/\//.test(signal)) return prefix + "_URL_INVALID";
  if (/WRONGPASS|NOAUTH|AUTHENTICATION/.test(signal)) return prefix + "_AUTH_REJECTED";
  if (/TLS|SSL|CERT|HANDSHAKE/.test(signal)) return prefix + "_TLS_FAILURE";
  if (/ENOTFOUND|EAI_AGAIN|DNS/.test(signal)) return prefix + "_DNS_FAILURE";
  if (/ETIMEDOUT|TIMEOUT/.test(signal)) return prefix + "_TIMEOUT";
  if (/ECONNREFUSED/.test(signal)) return prefix + "_CONNECTION_REFUSED";
  if (/ECONNRESET|EPIPE/.test(signal)) return prefix + "_CONNECTION_RESET";
  return prefix + "_UNAVAILABLE";
}

async function redis(command) {
  if (shouldUseValkey(process.env)) {
    try {
      if (!valkeyClient) {
        const Redis = require("ioredis");
        valkeyClient = createValkeyClient(process.env.VALKEY_URL, Redis);
      }
      return await executeValkeyCommand(valkeyClient, command);
    } catch (error) {
      const diagnostic = classifyRedisFailure(error, "VALKEY");
      console.error("Redis backend failure:", diagnostic);
      if (error && typeof error === "object") error.safeDiagnosticCode = diagnostic;
      throw error;
    }
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Upstash Redis is not configured");
  // Accept a pasted raw token or a copied "Bearer <token>" value, and
  // remove accidental outer whitespace before constructing the HTTP header.
  let authToken = token.trim();
  authToken = authToken.replace(/^Bearer\s+/i, "").trim();
  if ((authToken.startsWith('"') && authToken.endsWith('"')) ||
      (authToken.startsWith("'") && authToken.endsWith("'"))) {
    authToken = authToken.slice(1, -1).trim();
  }
  // Reject internal whitespace instead of silently rewriting a malformed credential.
  if (!authToken || /[\s\u0000-\u001F\u007F]/.test(authToken)) {
    throw new Error("Redis token has invalid formatting");
  }
  let response;
  try {
    const headers = new Headers({ Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" });
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(command)
    });
  } catch (error) {
    // Fetch/Headers exceptions can embed the Authorization header value.
    // Expose only a sanitized network error code, never the original message.
    // Inspect only a bounded cause chain and expose only standard error codes.
    // Fetch errors often wrap the DNS/TLS/socket failure one or two levels deep.
    const causes = [];
    let current = error;
    for (let depth = 0; current && depth < 4; depth += 1) {
      causes.push(current);
      current = current.cause;
    }
    const codes = causes.map(item => item.code)
      .filter(value => typeof value === "string")
      .map(value => value.toUpperCase());
    const code = codes.find(value => /^[A-Z0-9_]{2,40}$/.test(value))
      || causes.map(item => String(item.message || "").match(/\\b(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID)\\b/i)?.[1]?.toUpperCase()).find(Boolean)
      || causes.map(item => String(item.name || "").toUpperCase()).find(value => /^[A-Z0-9_]{2,40}$/.test(value) && value !== "ERROR")
      || "";
    throw new Error(code ? `Redis transport failed (${code})` : "Redis transport failed");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Redis response was invalid (HTTP_${response.status})`);
  }
  if (!response.ok) throw new Error(`Redis request failed (HTTP_${response.status})`);
  if (data.error) throw new Error("Redis command failed");
  return data.result;
}

async function consumeIpRateLimit(req, { limit = 40, windowSeconds = 900, scope = "chat" } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || !/^[a-z][a-z0-9_-]{0,30}$/.test(scope)) {
    throw new Error("Invalid IP rate-limit configuration");
  }
  // Vercel documents x-real-ip as its platform-set client address header.
  // Do not fall back to arbitrary client-supplied forwarding headers.
  const ip = String(req?.headers?.["x-real-ip"] || "").trim();
  if (!ip || require("net").isIP(ip) === 0) {
    const error = new Error("Trusted client IP is unavailable");
    error.code = "CLIENT_IP_UNAVAILABLE";
    throw error;
  }
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not configured");
  const digest = crypto.createHmac("sha256", secret).update(ip).digest("hex");
  const key = "vy:ratelimit:" + scope + ":" + digest;
  const script = "-- VY_IP_RATE_LIMIT\nlocal count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return count";
  const count = Number(await redis(["EVAL", script, "1", key, String(windowSeconds)]));
  return { count, limit, windowSeconds };
}

async function getAccount(req, res) {
  // A verified account session takes precedence over the browser's anonymous
  // cookie. Its UID is the original anonymous UID, so credits and question
  // history remain under the exact same Redis keys after registration/login.
  const { getUserSessionUid } = require("./user-auth");
  const uid = await getUserSessionUid(req) || getUid(req, res);
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

// Reserve, refund and commit are tied to a unique request ID. This makes
// retries safe even when Upstash applies a command but the HTTP response times out.
function validateReservation(cost, reservationId) {
  if (!/^[a-f0-9]{32}$/.test(reservationId || "") || !Number.isSafeInteger(cost) || cost < 1) {
    throw new Error("Invalid credit reservation");
  }
}

async function reserveCredits(key, cost, reservationId) {
  validateReservation(cost, reservationId);
  const reservationKey = `vy:reservation:${reservationId}`;
  const commitKey = `vy:commit:${reservationId}`;
  const refundKey = `vy:refund:${reservationId}`;
  const script = "if redis.call('EXISTS',KEYS[3])==1 or redis.call('EXISTS',KEYS[4])==1 then return -3 end; if redis.call('EXISTS',KEYS[2])==1 then return tonumber(redis.call('GET',KEYS[1]) or '0') end; local v=redis.call('GET',KEYS[1]); if not v then return -2 end; if tonumber(v)<tonumber(ARGV[1]) then return -1 end; local remaining=redis.call('DECRBY',KEYS[1],ARGV[1]); redis.call('SET',KEYS[2],ARGV[1],'EX',ARGV[2]); return remaining";
  return Number(await redis(["EVAL", script, "4", key, reservationKey, commitKey, refundKey, String(cost), "604800"]));
}

async function refundReservation(key, reservationId) {
  if (!/^[a-f0-9]{32}$/.test(reservationId || "")) throw new Error("Invalid credit reservation");
  const script = "if redis.call('EXISTS',KEYS[4])==1 then return 0 end; local cost=redis.call('GET',KEYS[2]); if not cost then return 0 end; if redis.call('SET',KEYS[3],'1','NX','EX',ARGV[1]) then local balance=redis.call('INCRBY',KEYS[1],cost); redis.call('DEL',KEYS[2]); return balance end; return tonumber(redis.call('GET',KEYS[1]) or '0')";
  return Number(await redis(["EVAL", script, "4", key, `vy:reservation:${reservationId}`, `vy:refund:${reservationId}`, `vy:commit:${reservationId}`, "604800"]));
}

async function commitReservation(reservationId) {
  if (!/^[a-f0-9]{32}$/.test(reservationId || "")) throw new Error("Invalid credit reservation");
  const script = "if redis.call('EXISTS',KEYS[3])==1 then return 0 end; if redis.call('EXISTS',KEYS[2])==1 then return 1 end; if not redis.call('GET',KEYS[1]) then return 0 end; redis.call('SET',KEYS[2],'1','NX','EX',ARGV[1]); redis.call('DEL',KEYS[1]); return 1";
  return Number(await redis(["EVAL", script, "3", `vy:reservation:${reservationId}`, `vy:commit:${reservationId}`, `vy:refund:${reservationId}`, "604800"]));
}

module.exports = { getAccount, classifyRequest, classifyRedisFailure, consume, refund, reserveCredits, refundReservation, commitReservation, consumeIpRateLimit, redis };
