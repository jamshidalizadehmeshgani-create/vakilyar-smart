"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldUseValkey, validateValkeyUrl, createValkeyClient, executeValkeyCommand } = require("../lib/valkey");
const { classifyRedisFailure } = require("../lib/quota");

test("only Vercel Preview selects Valkey", () => {
  assert.equal(shouldUseValkey({ VERCEL_ENV: "preview", VALKEY_URL: "rediss://preview" }), true);
  assert.equal(shouldUseValkey({ VERCEL_ENV: "production", VALKEY_URL: "rediss://preview" }), false);
  assert.equal(shouldUseValkey({ VERCEL_ENV: "development", VALKEY_URL: "rediss://preview" }), false);
  assert.equal(shouldUseValkey({ VERCEL_ENV: "preview" }), false);
});

test("Valkey URL validation accepts TLS URIs and trims outer whitespace", () => {
  assert.equal(validateValkeyUrl("  rediss://user:p%40ss@cache.example:1234  "), "rediss://user:p%40ss@cache.example:1234");
});

test("Valkey URL validation rejects provider reveal placeholders without exposing credentials", () => {
  assert.throws(
    () => validateValkeyUrl("rediss://default:CLICK_TO:REVEAL_PASSWORD@cache.example:1234"),
    error => error.code === "VALKEY_URL_REVEAL_PLACEHOLDER" && !error.message.includes("CLICK_TO")
  );
});

test("Valkey URL validation rejects malformed credential encoding", () => {
  assert.throws(
    () => validateValkeyUrl("rediss://default:bad%2@cache.example:1234"),
    error => error.code === "VALKEY_URL_INVALID_ENCODING"
  );
});

test("Valkey URL validation rejects non-TLS and hostless URLs", () => {
  assert.throws(() => validateValkeyUrl("redis://cache.example"), error => error.code === "VALKEY_URL_TLS_REQUIRED");
  assert.throws(() => validateValkeyUrl("rediss:///missing-host"), error => error.code === "VALKEY_URL_MISSING_HOST");
});

test("Valkey client enforces TLS and bounded connection behavior", () => {
  let captured;
  class FakeRedis {
    constructor(url, options) { captured = { url, options }; }
  }
  const client = createValkeyClient("rediss://example:1234", FakeRedis);
  assert.ok(client instanceof FakeRedis);
  assert.equal(captured.url, "rediss://example:1234");
  assert.equal(captured.options.lazyConnect, true);
  assert.equal(captured.options.connectTimeout, 5000);
  assert.equal(captured.options.maxRetriesPerRequest, 1);
  assert.equal(captured.options.enableOfflineQueue, false);
  assert.equal(captured.options.retryStrategy(1), 250);
  assert.equal(captured.options.retryStrategy(2), 500);
  assert.equal(captured.options.retryStrategy(3), null);
});

test("Valkey preserves raw Redis command arguments and results", async () => {
  let received;
  const client = {
    async call(...args) { received = args; return 37; }
  };
  const result = await executeValkeyCommand(client, ["EVAL", "return 1", 1, "key", 5]);
  assert.deepEqual(received, ["EVAL", "return 1", "1", "key", "5"]);
  assert.equal(result, 37);
  await assert.rejects(() => executeValkeyCommand(client, []), /Invalid Valkey command/);
});

test("Redis failures map to safe backend-specific diagnostics", () => {
  assert.equal(classifyRedisFailure({ code: "WRONGPASS" }, "VALKEY"), "VALKEY_AUTH_REJECTED");
  assert.equal(classifyRedisFailure({ code: "ETIMEDOUT" }, "VALKEY"), "VALKEY_TIMEOUT");
  assert.equal(classifyRedisFailure({ code: "ENOTFOUND" }, "VALKEY"), "VALKEY_DNS_FAILURE");
  assert.equal(classifyRedisFailure({ code: "ECONNREFUSED" }, "VALKEY"), "VALKEY_CONNECTION_REFUSED");
  assert.equal(classifyRedisFailure({ message: "certificate TLS handshake failed" }, "VALKEY"), "VALKEY_TLS_FAILURE");
  assert.equal(classifyRedisFailure({ message: "sensitive server details" }, "VALKEY"), "VALKEY_UNAVAILABLE");
  assert.equal(classifyRedisFailure({ code: "WRONGPASS" }, "UPSTASH"), "UPSTASH_AUTH_REJECTED");
  assert.equal(classifyRedisFailure({ code: "VALKEY_URL_TLS_REQUIRED" }, "VALKEY"), "VALKEY_URL_INVALID");
  assert.equal(classifyRedisFailure({ code: "MODULE_NOT_FOUND" }, "VALKEY"), "VALKEY_CLIENT_LIBRARY_MISSING");
  assert.equal(classifyRedisFailure({ code: "VALKEY_URL_REVEAL_PLACEHOLDER" }, "VALKEY"), "VALKEY_URL_REVEAL_PLACEHOLDER");
  assert.equal(classifyRedisFailure({ code: "VALKEY_URL_INVALID_ENCODING" }, "VALKEY"), "VALKEY_URL_INVALID_ENCODING");
  assert.equal(classifyRedisFailure({ code: "VALKEY_URL_MISSING_HOST" }, "VALKEY"), "VALKEY_URL_MISSING_HOST");
  assert.equal(classifyRedisFailure({ code: "VALKEY_URL_PARSE_FAILURE" }, "VALKEY"), "VALKEY_URL_PARSE_FAILURE");
});
