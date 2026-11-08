"use strict";

function validateValkeyUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error("Valkey URL is empty");
    error.code = "VALKEY_URL_EMPTY";
    throw error;
  }

  const url = value.trim();
  if (!url.startsWith("rediss://")) {
    const error = new Error("Valkey URL must use TLS");
    error.code = "VALKEY_URL_TLS_REQUIRED";
    throw error;
  }

  const authority = url.slice("rediss://".length).split(/[/?#]/, 1)[0];
  const at = authority.lastIndexOf("@");
  const userInfo = at >= 0 ? authority.slice(0, at) : "";
  if (/CLICK_TO:REVEAL_PASSWORD/i.test(userInfo)) {
    const error = new Error("Valkey provider password placeholder detected");
    error.code = "VALKEY_URL_REVEAL_PLACEHOLDER";
    throw error;
  }
  if (/%(?![0-9a-f]{2})/i.test(userInfo)) {
    const error = new Error("Valkey URL userinfo has invalid percent encoding");
    error.code = "VALKEY_URL_INVALID_ENCODING";
    throw error;
  }

  let parsed;
  let decodedUserInfo = "";
  try {
    parsed = new URL(url);
    // Force decoding so malformed encoded credentials fail before ioredis.
    decodedUserInfo = decodeURIComponent(parsed.username) + ":" + decodeURIComponent(parsed.password);
  } catch {
    const error = new Error("Valkey URL is malformed");
    error.code = "VALKEY_URL_PARSE_FAILURE";
    throw error;
  }
  // Providers sometimes URL-encode placeholder text; inspect decoded credentials too.
  if (/CLICK_TO:REVEAL_PASSWORD/i.test(decodedUserInfo)) {
    const error = new Error("Valkey provider password placeholder detected");
    error.code = "VALKEY_URL_REVEAL_PLACEHOLDER";
    throw error;
  }
  if (!parsed.hostname) {
    const error = new Error("Valkey URL hostname is missing");
    error.code = "VALKEY_URL_MISSING_HOST";
    throw error;
  }
  return url;
}

function shouldUseValkey(env = process.env) {
  return env.VERCEL_ENV === "preview" && Boolean(String(env.VALKEY_URL || "").trim());
}

function createValkeyClient(url, Redis) {
  const validatedUrl = validateValkeyUrl(url);
  if (typeof Redis !== "function") throw new Error("Valkey client library is unavailable");
  return new Redis(validatedUrl, {
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
  return client.call(...command.map(value => String(value)));
}

module.exports = { shouldUseValkey, validateValkeyUrl, createValkeyClient, executeValkeyCommand };
