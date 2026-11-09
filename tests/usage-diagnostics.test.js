"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const quota = require("../lib/quota");

test("usage endpoint does not expose arbitrary storage error codes", async () => {
  const originalConsume = quota.consumeIpRateLimit;
  const envKeys = ["VERCEL_ENV", "APP_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  let payload;
  let statusCode;

  quota.consumeIpRateLimit = async () => {
    const error = new Error("internal failure");
    error.code = "TOKEN_SECRET_CUSTOM_VALUE";
    throw error;
  };

  process.env.VERCEL_ENV = "production";
  process.env.APP_SECRET = "test-only-secret";
  process.env.UPSTASH_REDIS_REST_URL = "https://example.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

  try {
    const handler = require("../handlers/usage");
    const req = { method: "GET", headers: {} };
    const res = {
      setHeader() {},
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return body; }
    };

    await handler(req, res);
    assert.equal(statusCode, 503);
    assert.equal(payload.storage_diagnostic, "REDIS_STORAGE_ERROR");
    assert.notEqual(payload.storage_diagnostic, "TOKEN_SECRET_CUSTOM_VALUE");
  } finally {
    quota.consumeIpRateLimit = originalConsume;
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("usage endpoint preserves only the documented safe storage error codes", async () => {
  const originalConsume = quota.consumeIpRateLimit;
  const envKeys = ["VERCEL_ENV", "APP_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const safeCodes = [
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EPIPE",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "CLIENT_IP_UNAVAILABLE"
  ];

  process.env.VERCEL_ENV = "production";
  process.env.APP_SECRET = "test-only-secret";
  process.env.UPSTASH_REDIS_REST_URL = "https://example.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

  try {
    const handler = require("../handlers/usage");
    for (const code of safeCodes) {
      quota.consumeIpRateLimit = async () => {
        const error = new Error("internal failure");
        error.code = code;
        throw error;
      };

      let payload;
      let statusCode;
      const req = { method: "GET", headers: {} };
      const res = {
        setHeader() {},
        status(status) { statusCode = status; return this; },
        json(body) { payload = body; return body; }
      };

      await handler(req, res);
      assert.equal(statusCode, 503, `unexpected status for ${code}`);
      assert.equal(payload.storage_diagnostic, code, `safe code was not preserved: ${code}`);
    }
  } finally {
    quota.consumeIpRateLimit = originalConsume;
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
