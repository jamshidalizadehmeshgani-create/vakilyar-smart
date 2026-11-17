"use strict";

function shouldUseValkey(env = process.env) {
  return env.VERCEL_ENV === "preview" && Boolean(String(env.VALKEY_URL || "").trim());
}

function createValkeyClient(url, Redis) {
  if (typeof url !== "string" || !url.startsWith("rediss://")) {
    throw new Error("Preview Valkey URL must use rediss:// TLS");
  }
  if (typeof Redis !== "function") throw new Error("Valkey client library is unavailable");
  return new Redis(url, {
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

module.exports = { shouldUseValkey, createValkeyClient, executeValkeyCommand };
