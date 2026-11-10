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

test("session lookup checks the stored session version against the account", async () => {
  const originalFetch = global.fetch;
  const previous = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  const sessionToken = "a".repeat(64), uid = "b".repeat(48), commands = [];
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body); commands.push(command);
    const result = command[0] === "GET" && command[1] === "vy:user:session:" + auth.hash(sessionToken)
      ? uid + ":0"
      : command[0] === "GET" && command[1] === "vy:user:account:" + uid
        ? JSON.stringify({ uid, session_version: 0 }) : null;
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  try {
    assert.equal(await auth.getUserSessionUid({ headers: { cookie: auth.SESSION_COOKIE + "=" + sessionToken } }), uid);
    assert.equal(commands[0][1], "vy:user:session:" + crypto.createHash("sha256").update(sessionToken).digest("hex"));
    assert.equal(commands[1][1], "vy:user:account:" + uid);
    assert.equal(await auth.getUserSessionUid({ headers: { cookie: auth.SESSION_COOKIE + "=not-a-token" } }), "");
    assert.equal(commands.length, 2);
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  }
});

test("session lookup invalidates a legacy session after the account version is advanced", async () => {
  const originalFetch = global.fetch;
  const previous = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  const token = "f".repeat(64), uid = "e".repeat(48), commands = [];
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body); commands.push(command);
    let result = null;
    if (command[0] === "GET" && command[1] === "vy:user:session:" + auth.hash(token)) result = uid;
    else if (command[0] === "GET" && command[1] === "vy:user:account:" + uid) result = JSON.stringify({ uid, session_version: 1 });
    else if (command[0] === "EVAL") result = 1;
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  try {
    assert.equal(await auth.getUserSessionUid({ headers: { cookie: auth.SESSION_COOKIE + "=" + token } }), "");
    assert.equal(commands.at(-1)[0], "EVAL");
    assert.match(commands.at(-1)[1], /SREM/);
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  }
});

test("new user sessions are indexed and bind the current account session version atomically", async () => {
  const originalFetch = global.fetch, previous = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test"; process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  let command;
  global.fetch = async (url, options) => { command = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ result: 2 }) }; };
  const headers = {};
  try {
    await auth.createUserSession("c".repeat(48), { setHeader: (name, value) => { headers[name] = value; } });
    assert.equal(command[0], "EVAL");
    assert.match(command[1], /session_version/);
    assert.match(command[1], /SADD/);
    assert.match(command[1], /EXPIRE/);
    assert.equal(command[2], "3");
    assert.match(headers["Set-Cookie"], /HttpOnly/);
    assert.match(headers["Set-Cookie"], /Max-Age=2592000/);
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  }
});

test("password reset atomically advances session version and deletes session and reset-token indexes", async () => {
  const originalFetch = global.fetch, previous = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test"; process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  const uid = "d".repeat(48), token = "a".repeat(64), passwordHash = "b".repeat(32) + ":" + "c".repeat(128);
  let command;
  global.fetch = async (url, options) => { command = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ result: uid }) }; };
  try {
    assert.equal(await auth.resetUserPassword(token, passwordHash, "2026-11-10T12:00:00.000Z"), uid);
    assert.equal(command[0], "EVAL");
    assert.equal(command[2], "1");
    assert.equal(command[3], "vy:user:password-reset:" + auth.hash(token));
    assert.match(command[1], /session_version/);
    assert.match(command[1], /password-reset-tokens/);
    assert.match(command[1], /SMEMBERS/);
    assert.match(command[1], /redis.call\('DEL'/);
    assert.equal(command.includes(token), false);
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

test("authenticated session reuses the original anonymous UID for credits and question history", async () => {
  const originalFetch = global.fetch;
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    secret: process.env.APP_SECRET
  };
  const uid = "c".repeat(48);
  const sessionToken = "d".repeat(64);
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  process.env.APP_SECRET = "identity-preservation-test-secret";
  const anonymousUid = "e".repeat(48);
  const signature = crypto.createHmac("sha256", process.env.APP_SECRET).update(anonymousUid).digest("base64url");
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    let result = null;
    if (command[0] === "GET" && command[1].startsWith("vy:user:session:")) result = uid + ":0";
    else if (command[0] === "GET" && command[1] === "vy:user:account:" + uid) result = JSON.stringify({ uid, session_version: 0 });
    else if (command[0] === "EVAL") result = 735;
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  try {
    const { getAccount } = require("../lib/quota");
    const account = await getAccount({
      headers: { cookie: "vy_uid=" + anonymousUid + "." + signature + "; " + auth.SESSION_COOKIE + "=" + sessionToken }
    }, { setHeader() {} });
    assert.equal(account.uid, uid);
    assert.equal(account.key, "vy:user:" + uid + ":credits");
    assert.equal(account.credits, 735);
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
    if (previous.secret === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = previous.secret;
  }
});
