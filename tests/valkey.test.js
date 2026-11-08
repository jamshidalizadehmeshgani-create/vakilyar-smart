"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldUseValkey, createValkeyClient, executeValkeyCommand, getValkeyDiagnostic, getValkeyUrlDiagnostic } = require("../lib/valkey");

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

test("Valkey URL trims outer whitespace but rejects quoted or malformed values safely", () => {
  let captured;
  class FakeRedis {
    constructor(url) { captured = url; }
  }
  createValkeyClient("  rediss://example:1234  \n", FakeRedis);
  assert.equal(captured, "rediss://example:1234");
  assert.throws(
    () => createValkeyClient('"rediss://example:1234"', FakeRedis),
    error => getValkeyDiagnostic(error) === "VALKEY_URL_FORMAT_ERROR"
  );
  assert.throws(
    () => createValkeyClient("not-a-url", FakeRedis),
    error => getValkeyDiagnostic(error) === "VALKEY_URL_FORMAT_ERROR"
  );
});


test("Valkey URL diagnostics identify the cause without exposing URL contents", () => {
  assert.equal(getValkeyUrlDiagnostic(""), "VALKEY_URL_EMPTY");
  assert.equal(getValkeyUrlDiagnostic('"rediss://secret-host:1234"'), "VALKEY_URL_QUOTED");
  assert.equal(getValkeyUrlDiagnostic("rediss://secret host:1234"), "VALKEY_URL_WHITESPACE");
  assert.equal(getValkeyUrlDiagnostic("not-a-url"), "VALKEY_URL_PARSE_ERROR");
  assert.equal(getValkeyUrlDiagnostic("redis://secret-host:1234"), "VALKEY_URL_TLS_REQUIRED");
  assert.equal(getValkeyUrlDiagnostic("rediss:///path"), "VALKEY_URL_HOST_MISSING");
  assert.equal(getValkeyUrlDiagnostic("  rediss://secret-host:1234  "), null);

  const error = Object.assign(new Error("private detail"), { code: "VALKEY_URL_QUOTED" });
  assert.equal(getValkeyDiagnostic(error), "VALKEY_URL_QUOTED");
  assert.equal(getValkeyDiagnostic(error).includes("secret-host"), false);
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

test("Valkey connection errors expose only allowlisted diagnostic codes", async () => {
  const client = {
    async call() { throw new Error("connect ECONNREFUSED private-host.example:16593"); }
  };
  await assert.rejects(
    () => executeValkeyCommand(client, ["PING"]),
    error => error.code === "ECONNREFUSED" &&
      error.message === "Valkey command failed" &&
      !error.message.includes("private-host")
  );
});

test("Valkey authentication and TLS diagnostics are sanitized", () => {
  assert.equal(getValkeyDiagnostic(Object.assign(new Error("WRONGPASS secret detail"), { code: "WRONGPASS" })), "WRONGPASS");
  assert.equal(getValkeyDiagnostic(new Error("certificate verify failed")), "TLS_ERROR");
  assert.equal(getValkeyDiagnostic(new Error("Preview Valkey URL must use rediss:// TLS")), "VALKEY_TLS_CONFIGURATION_ERROR");
  assert.equal(getValkeyDiagnostic(new Error("Preview Valkey URL has surrounding quotes")), "VALKEY_URL_FORMAT_ERROR");
  assert.equal(getValkeyDiagnostic(new Error("opaque internal detail")), "VALKEY_CONNECTION_ERROR");
});
