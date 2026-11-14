const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { consumeIpRateLimit } = require("../lib/quota");

test("IP rate limiting trusts only a valid platform x-real-ip and hashes it", async () => {
  const originalFetch = global.fetch;
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    secret: process.env.APP_SECRET
  };
  const secret = "ip-rate-limit-test-secret";
  const ip = "203.0.113.42";
  const commands = [];
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  process.env.APP_SECRET = secret;
  global.fetch = async (_url, options) => {
    commands.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ result: 1 }) };
  };

  try {
    await assert.rejects(
      consumeIpRateLimit({ headers: { "x-forwarded-for": ip } }, { scope: "test-ip" }),
      error => error && error.code === "CLIENT_IP_UNAVAILABLE"
    );
    await assert.rejects(
      consumeIpRateLimit({ headers: { "x-real-ip": "not-an-ip" } }, { scope: "test-ip" }),
      error => error && error.code === "CLIENT_IP_UNAVAILABLE"
    );
    assert.equal(commands.length, 0, "untrusted or malformed IPs must not reach Redis");

    const result = await consumeIpRateLimit(
      { headers: { "x-real-ip": ip, "x-forwarded-for": "198.51.100.9" } },
      { scope: "test-ip", limit: 4, windowSeconds: 600 }
    );
    const digest = crypto.createHmac("sha256", secret).update(ip).digest("hex");
    assert.deepEqual(result, { count: 1, limit: 4, windowSeconds: 600 });
    assert.equal(commands.length, 1);
    assert.equal(commands[0][0], "EVAL");
    assert.equal(commands[0][2], "1");
    assert.equal(commands[0][3], "vy:ratelimit:test-ip:" + digest);
    assert.equal(commands[0][3].includes(ip), false);
    assert.equal(commands[0][4], "600");
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
    if (previous.secret === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = previous.secret;
  }
});
