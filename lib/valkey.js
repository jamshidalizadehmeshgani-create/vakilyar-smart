"use strict";

const SAFE_DIAGNOSTICS = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "NR_CLOSED",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "WRONGPASS", "NOAUTH", "NOPERM", "LOADING", "READONLY",
  "CLUSTERDOWN", "MOVED", "ASK", "CROSSSLOT",
  "VALKEY_URL_EMPTY", "VALKEY_URL_QUOTES", "VALKEY_URL_WHITESPACE",
  "VALKEY_URL_PARSE_ERROR", "VALKEY_URL_TLS_REQUIRED", "VALKEY_URL_HOST_MISSING",
  "VALKEY_URL_PASSWORD_PLACEHOLDER", "VALKEY_URL_CREDENTIALS_ENCODING_ERROR",
  "VALKEY_URL_SCHEME_MISSING"
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
    const error = new Error("Preview Valkey URL is empty");
    error.code = "VALKEY_URL_EMPTY";
    throw error;
  }

  // Environment variables can accidentally contain outer whitespace when
  // copied from a dashboard. Normalize only that whitespace; never log it.
  const normalizedUrl = url.trim();
  if ((normalizedUrl.startsWith('"') && normalizedUrl.endsWith('"')) ||
      (normalizedUrl.startsWith("'") && normalizedUrl.endsWith("'"))) {
    const error = new Error("Preview Valkey URL has surrounding quotes");
    error.code = "VALKEY_URL_QUOTES";
    throw error;
  }
  if (/\s/.test(normalizedUrl)) {
    const error = new Error("Preview Valkey URL contains internal whitespace");
    error.code = "VALKEY_URL_WHITESPACE";
    throw error;
  }

  // Diagnose common dashboard-copy mistakes using patterns only.
  // Never include the URL, userinfo, password, or parser exception in output.
  if (/CLICK_TO:REVEAL_PASSWORD/i.test(normalizedUrl)) {
    const error = new Error("Preview Valkey URL still contains the provider password placeholder");
    error.code = "VALKEY_URL_PASSWORD_PLACEHOLDER";
    throw error;
  }
  if (!/^rediss:\/\//i.test(normalizedUrl)) {
    const error = new Error("Preview Valkey URL must begin with rediss://");
    error.code = "VALKEY_URL_SCHEME_MISSING";
    throw error;
  }
  const authority = normalizedUrl.slice(normalizedUrl.indexOf("//") + 2).split(/[/?#]/, 1)[0];
  const userInfo = authority.includes("@") ? authority.slice(0, authority.lastIndexOf("@")).split(":").slice(1).join(":") : "";
  if (userInfo && /%(?![0-9a-f]{2})/i.test(userInfo)) {
    const error = new Error("Preview Valkey URL credentials contain invalid percent encoding");
    error.code = "VALKEY_URL_CREDENTIALS_ENCODING_ERROR";
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    const error = new Error("Preview Valkey URL could not be parsed");
    error.code = "VALKEY_URL_PARSE_ERROR";
    throw error;
  }
  if (parsed.protocol !== "rediss:") {
    const error = new Error("Preview Valkey URL must use rediss:// TLS");
    error.code = "VALKEY_URL_TLS_REQUIRED";
    throw error;
  }
  if (!parsed.hostname) {
    const error = new Error("Preview Valkey URL hostname is missing");
    error.code = "VALKEY_URL_HOST_MISSING";
    throw error;
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
