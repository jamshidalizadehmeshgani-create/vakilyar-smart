const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const auth = require("../lib/user-auth");

test("public-user email and password validation is bounded", () => {
  assert.equal(auth.validEmail("person@example.com"), true);
  assert.equal(auth.validEmail("bad-email"), false);
  assert.equal(auth.validEmail("x".repeat(190) + "@example.com"), false);
  assert.equal(auth.validPassword("correct horse battery"), true);
  assert.equal(auth.validPassword("short"), false);
  assert.equal(auth.validPassword("x".repeat(201)), false);
});

test("password hashes are salted and verified without storing plaintext", async () => {
  const password = "a-long-test-password";
  const first = await auth.hashPassword(password);
  const second = await auth.hashPassword(password);
  assert.match(first, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.notEqual(first, second);
  assert.equal(await auth.verifyPassword(password, first), true);
  assert.equal(await auth.verifyPassword("wrong-password", first), false);
  assert.equal(first.includes(password), false);
});

test("session lookup accepts only a valid random token and uses a hashed Redis key", async () => {
  const originalFetch = global.fetch;
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  };
  const sessionToken = "a".repeat(64);
  const uid = "b".repeat(48);
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  let command;
  global.fetch = async (url, options) => {
    command = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ result: uid }) };
  };
  try {
    const found = await auth.getUserSessionUid({ headers: { cookie: auth.SESSION_COOKIE + "=" + sessionToken } });
    assert.equal(found, uid);
    assert.equal(command[0], "GET");
    assert.equal(command[1], "vy:user:session:" + crypto.createHash("sha256").update(sessionToken).digest("hex"));
    const invalid = await auth.getUserSessionUid({ headers: { cookie: auth.SESSION_COOKIE + "=not-a-token" } });
    assert.equal(invalid, "");
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  }
});

test("user session cookie is HttpOnly, Secure, SameSite=Lax and expires", () => {
  const header = auth.cookie("a".repeat(64), auth.SESSION_SECONDS);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=2592000/);
  assert.equal(auth.hash("abc").length, 64);
});
