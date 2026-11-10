const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { consumeAccountRateLimit } = require("../lib/quota");

test("account rate limits use an HMAC key and an atomic expiring Redis counter", async () => {
  const originalFetch = global.fetch;
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    secret: process.env.APP_SECRET
  };
  const uid = "a".repeat(48);
  const secret = "account-rate-limit-test-secret";
  let command;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  process.env.APP_SECRET = secret;
  global.fetch = async (url, options) => {
    command = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ result: 2 }) };
  };
  try {
    const result = await consumeAccountRateLimit(uid, {
      scope: "user-password-reset-account",
      limit: 3,
      windowSeconds: 3600
    });
    const digest = crypto.createHmac("sha256", secret).update(uid).digest("hex");
    assert.deepEqual(result, { count: 2, limit: 3, windowSeconds: 3600 });
    assert.equal(command[0], "EVAL");
    assert.equal(command[2], "1");
    assert.equal(command[3], "vy:ratelimit:user-password-reset-account:" + digest);
    assert.equal(command[3].includes(uid), false);
    assert.match(command[1], /INCR/);
    assert.match(command[1], /EXPIRE/);
    assert.match(command[1], /\nlocal/);
    assert.equal(command[4], "3600");
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
    if (previous.secret === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = previous.secret;
  }
});
