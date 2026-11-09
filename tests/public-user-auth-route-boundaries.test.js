const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHandler(file, modules) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const module = { exports: null };
  const sandbox = {
    module,
    exports: module.exports,
    require(id) {
      if (id === "crypto") return require("node:crypto");
      if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
      throw new Error("Unexpected module: " + id);
    },
    process: { env: {} },
    console: { error() {} },
    Date
  };
  vm.runInNewContext(source, sandbox, { filename: file });
  return module.exports;
}

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

const sameOriginRequest = {
  headers: { host: "app.example.test", origin: "https://app.example.test", "sec-fetch-site": "same-origin" }
};

test("public registration rejects cross-origin requests before rate limiting or account creation", async () => {
  let rateLimitCalls = 0;
  let accountCalls = 0;
  const handler = loadHandler("handlers/users/register.js", {
    "../../lib/quota": {
      consumeIpRateLimit: async () => { rateLimitCalls++; return { count: 1, limit: 5 }; },
      getAccount: async () => { accountCalls++; return { uid: "a".repeat(48) }; }
    },
    "../../lib/user-auth": { sameOrigin: () => false }
  });
  const res = response();
  await handler({
    method: "POST",
    headers: { host: "app.example.test", origin: "https://attacker.example" },
    body: { first_name: "کاربر", last_name: "آزمایشی", email: "user@example.test", password: "long-test-password" }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(rateLimitCalls, 0);
  assert.equal(accountCalls, 0);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("public registration validates fields before creating an anonymous account", async () => {
  let accountCalls = 0;
  const handler = loadHandler("handlers/users/register.js", {
    "../../lib/quota": {
      consumeIpRateLimit: async () => ({ count: 1, limit: 5 }),
      getAccount: async () => { accountCalls++; return { uid: "a".repeat(48) }; }
    },
    "../../lib/user-auth": {
      sameOrigin: () => true,
      validEmail: () => false,
      validPassword: () => true
    }
  });
  const res = response();
  await handler({
    method: "POST", headers: sameOriginRequest.headers,
    body: { first_name: "کاربر", last_name: "آزمایشی", email: "invalid", password: "long-test-password" }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(accountCalls, 0);
});

test("public login refuses an unverified account and never creates a session", async () => {
  let sessionCalls = 0;
  const handler = loadHandler("handlers/users/login.js", {
    "../../lib/quota": { consumeIpRateLimit: async () => ({ count: 1, limit: 20 }) },
    "../../lib/user-auth": {
      sameOrigin: () => true,
      validEmail: () => true,
      verifyPassword: async () => true,
      getUserByEmail: async () => ({ uid: "b".repeat(48), email_verified: false, password_hash: "test" }),
      createUserSession: async () => { sessionCalls++; }
    }
  });
  const res = response();
  await handler({
    method: "POST", headers: sameOriginRequest.headers,
    body: { email: "user@example.test", password: "long-test-password" }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(sessionCalls, 0);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("resending verification uses the same generic response when the email is unknown", async () => {
  let verificationCalls = 0;
  const handler = loadHandler("handlers/users/resend-verification.js", {
    "../../lib/quota": { consumeIpRateLimit: async () => ({ count: 1, limit: 3 }) },
    "../../lib/user-auth": {
      sameOrigin: () => true,
      validEmail: () => true,
      getUserByEmail: async () => null,
      issueVerification: async () => { verificationCalls++; }
    }
  });
  const res = response();
  await handler({
    method: "POST", headers: sameOriginRequest.headers,
    body: { email: "not-registered@example.test" }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.message, /اگر حساب تأییدنشده‌ای/);
  assert.equal(verificationCalls, 0);
  assert.equal(JSON.stringify(res.body).includes("not-registered@example.test"), false);
});

test("public logout rejects cross-origin requests before revoking a session", async () => {
  let clearCalls = 0;
  const handler = loadHandler("handlers/users/logout.js", {
    "../../lib/user-auth": {
      sameOrigin: () => false,
      clearUserSession: async () => { clearCalls++; }
    }
  });
  const res = response();
  await handler({
    method: "POST",
    headers: { host: "app.example.test", origin: "https://attacker.example" }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(clearCalls, 0);
  assert.equal(res.headers["Cache-Control"], "no-store");
});
