"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldUseValkey, createValkeyClient, executeValkeyCommand } = require("../lib/valkey");

test("only Vercel Preview selects Valkey", () => {
  assert.equal(shouldUseValkey({ VERCEL_ENV: "preview", VALKEY_URL: "rediss://preview" }), true);
  assert.equal(shouldUseValkey({ VERCEL_ENV: "production", VALKEY_URL: "rediss://preview" }), false);
  assert.equal(shouldUseValkey({ VERCEL_ENV: "development", VALKEY_URL: "rediss://preview" }), false);
  assert.equal(shouldUseValkey({ VERCEL_ENV: "preview" }), false);
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
  assert.throws(() => createValkeyClient("redis://insecure", FakeRedis), /rediss/);
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
