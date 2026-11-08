"use strict";

const SAFE_DIAGNOSTICS = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "NR_CLOSED",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "WRONGPASS", "NOAUTH", "NOPERM", "LOADING", "READONLY",
  "CLUSTERDOWN", "MOVED", "ASK", "CROSSSLOT"
]);

function shouldUseValkey(env = process.env) {
  return env.VERCEL_ENV === "preview" && Boolean(String(env.VALKEY_URL || "").trim());
}

// Convert client/server failures to a small allowlist. Never return the
// original message: ioredis messages can contain hostnames or connection data.
function getValkeyDiagnostic(error) {
  const code = String(error && error.code || "").toUpperCase();
  if (SAFE_DIAGNOSTICS.has(code)) return code;

  const message = String(error && error.message || "").toUpperCase();
  if (/SURROUNDING QUOTES|WRAPPED IN QUOTES/.test(message)) return "VALKEY_URL_FORMAT_ERROR";
  if (/URL FORMAT IS INVALID|INVALID VALKEY URL/.test(message)) return "VALKEY_URL_FORMAT_ERROR";
  for (const candidate of SAFE_DIAGNOSTICS) {
    if (new RegExp("(^|[^A-Z0-9_])" + candidate + "([^A-Z0-9_]|$)").test(message)) {
      return candidate;
    }
  }
  if (/TIMED?\s*OUT|TIMEOUT/.test(message)) return "ETIMEDOUT";
  if (/SOCKET HANG UP|CONNECTION RESET/.test(message)) return "ECONNRESET";
  if (/MUST USE REDISS|TLS URL|TLS CONFIGURATION/.test(message)) return "VALKEY_TLS_CONFIGURATION_ERROR";
  if (/TLS|SSL|CERTIFICATE/.test(message)) return "TLS_ERROR";
  if (/^ERR\b|REPLYERROR/.test(message) || (error && error.name === "ReplyError")) {
    return "REDIS_SERVER_ERROR";
  }
  return "VALKEY_CONNECTION_ERROR";
}

function createValkeyClient(url, Redis) {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Preview Valkey URL format is invalid");
  }

  // Environment variables can accidentally contain outer whitespace when
  // copied from a dashboard. Normalize only that whitespace; never log it.
  const normalizedUrl = url.trim();
  if ((normalizedUrl.startsWith('"') && normalizedUrl.endsWith('"')) ||
      (normalizedUrl.startsWith("'") && normalizedUrl.endsWith("'"))) {
    throw new Error("Preview Valkey URL has surrounding quotes");
  }
  if (/\s/.test(normalizedUrl)) {
    throw new Error("Preview Valkey URL format is invalid");
  }

  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new Error("Preview Valkey URL format is invalid");
  }
  if (parsed.protocol !== "rediss:" || !parsed.hostname) {
    throw new Error("Preview Valkey URL must use rediss:// TLS");
  }
  if (typeof Redis !== "function") throw new Error("Valkey client library is unavailable");

  return new Redis(normalizedUrl, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy(times) {
      return times <= 2 ? times * 250 : null;
    }
  });
}

async function executeValkeyCommand(client, command) {
  if (!client || typeof client.call !== "function" || !Array.isArray(command) || command.length === 0) {
    throw new Error("Invalid Valkey command");
  }
  try {
    return await client.call(...command.map(value => String(value)));
  } catch (error) {
    const safeError = new Error("Valkey command failed");
    safeError.code = getValkeyDiagnostic(error);
    throw safeError;
  }
}

module.exports = { shouldUseValkey, createValkeyClient, executeValkeyCommand, getValkeyDiagnostic };
