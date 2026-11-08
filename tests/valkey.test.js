"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldUseValkey, createValkeyClient, executeValkeyCommand, getValkeyDiagnostic } = require("../lib/valkey");

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
    error => getValkeyDiagnostic(error) === "VALKEY_URL_QUOTES"
  );
  assert.throws(
    () => createValkeyClient("not-a-url", FakeRedis),
    error => getValkeyDiagnostic(error) === "VALKEY_URL_PARSE_ERROR"
  );
});

test("Aiven-style TLS URL accepts username and percent-encoded password without exposing credentials", () => {
  let captured;
  class FakeRedis {
    constructor(url) { captured = url; }
  }
  const url = "rediss://default:p%40ss%3Aword@vakilyar-valkey-preview-jamshid-f994.c.aivencloud.com:16593";
  createValkeyClient(url, FakeRedis);
  assert.equal(captured, url);
});

test("Valkey URL diagnostics distinguish safe input-format causes", () => {
  const cases = [
    [undefined, "VALKEY_URL_EMPTY"],
    ["rediss://host name:16593", "VALKEY_URL_WHITESPACE"],
    ["https://example.com", "VALKEY_URL_TLS_REQUIRED"],
    ["rediss://", "VALKEY_URL_HOST_MISSING"]
  ];
  for (const [url, expected] of cases) {
    assert.throws(
      () => createValkeyClient(url, function FakeRedis() {}),
      error => getValkeyDiagnostic(error) === expected
    );
  }
});

test("Valkey reports safe diagnostics for common copied-URI mistakes", () => {
  const cases = [
    ["rediss://default:CLICK_TO:REVEAL_PASSWORD@host.example:16593", "VALKEY_URL_PASSWORD_PLACEHOLDER"],
    ["default:password@host.example:16593", "VALKEY_URL_SCHEME_MISSING"],
    ["rediss://default:bad%XZ@host.example:16593", "VALKEY_URL_CREDENTIALS_ENCODING_ERROR"]
  ];
  for (const [url, expected] of cases) {
    assert.throws(
      () => createValkeyClient(url, function FakeRedis() {}),
      error => getValkeyDiagnostic(error) === expected
    );
  }
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
