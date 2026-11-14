const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHandler(file, modules) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const module = { exports: null };
  const sandbox = {
    module, exports: module.exports,
    require(id) {
      if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
      throw new Error("Unexpected module: " + id);
    },
    console: { error() {} }, Date
  };
  vm.runInNewContext(source, sandbox, { filename: file });
  return module.exports;
}
function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}
const goodHeaders = { host: "app.example.test", origin: "https://app.example.test", "sec-fetch-site": "same-origin" };

test("password reset request gives the same public response for an unknown email", async () => {
  let issued = 0, mailed = 0;
  const handler = loadHandler("handlers/users/request-password-reset.js", {
    "../../lib/quota": { consumeIpRateLimit: async () => ({ count: 1, limit: 3 }), consumeAccountRateLimit: async () => ({ count: 1, limit: 3 }) },
    "../../lib/user-auth": {
      validEmail: () => true, getUserByEmail: async () => null,
      issuePasswordReset: async () => { issued++; return "a".repeat(64); },
      discardPasswordResetToken: async () => {}, sameOrigin: () => true
    },
    "../../lib/email": { sendUserPasswordResetEmail: async () => { mailed++; return { sent: true }; } }
  });
  const res = response();
  await handler({ method: "POST", headers: goodHeaders, body: { email: "unknown@example.test" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.message, /اگر حساب فعالی/);
  assert.equal(issued, 0);
  assert.equal(mailed, 0);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("password reset request removes an issued token when email delivery is unavailable", async () => {
  const calls = [];
  const handler = loadHandler("handlers/users/request-password-reset.js", {
    "../../lib/quota": { consumeIpRateLimit: async () => ({ count: 1, limit: 3 }), consumeAccountRateLimit: async () => ({ count: 1, limit: 3 }) },
    "../../lib/user-auth": {
      validEmail: () => true,
      getUserByEmail: async () => ({ uid: "b".repeat(48), email: "user@example.test", first_name: "کاربر", email_verified: true }),
      issuePasswordReset: async () => "a".repeat(64),
      discardPasswordResetToken: async (...args) => calls.push(args),
      sameOrigin: () => true
    },
    "../../lib/email": { sendUserPasswordResetEmail: async () => ({ sent: false, reason: "not_configured" }) }
  });
  const res = response();
  await handler({ method: "POST", headers: goodHeaders, body: { email: "user@example.test" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "a".repeat(64));
  assert.equal(calls[0][1], "b".repeat(48));
  assert.equal(JSON.stringify(res.body).includes("user@example.test"), false);
});

test("password reset request rejects cross-origin requests before rate limiting", async () => {
  let rateCalls = 0;
  const handler = loadHandler("handlers/users/request-password-reset.js", {
    "../../lib/quota": { consumeIpRateLimit: async () => { rateCalls++; return { count: 1, limit: 3 }; }, consumeAccountRateLimit: async () => ({ count: 1, limit: 3 }) },
    "../../lib/user-auth": { sameOrigin: () => false },
    "../../lib/email": {}
  });
  const res = response();
  await handler({ method: "POST", headers: { host: "app.example.test", origin: "https://evil.example" }, body: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(rateCalls, 0);
});

test("password reset completion rejects invalid and expired tokens without setting a session", async () => {
  let resetCalls = 0;
  const handler = loadHandler("handlers/users/reset-password.js", {
    "../../lib/quota": { consumeIpRateLimit: async () => ({ count: 1, limit: 5 }) },
    "../../lib/user-auth": {
      validPassword: () => true, hashPassword: async () => "c".repeat(32) + ":" + "d".repeat(128),
      resetUserPassword: async () => { resetCalls++; return ""; },
      sameOrigin: () => true, cookie: () => "expired"
    }
  });
  const res = response();
  await handler({ method: "POST", headers: goodHeaders, body: { token: "a".repeat(64), password: "new-password-123" } }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(resetCalls, 1);
  assert.equal(res.headers["Set-Cookie"], undefined);
});

test("successful password reset clears browser cookies and reports session revocation", async () => {
  const calls = [];
  const handler = loadHandler("handlers/users/reset-password.js", {
    "../../lib/quota": { consumeIpRateLimit: async () => ({ count: 1, limit: 5 }) },
    "../../lib/user-auth": {
      validPassword: () => true, hashPassword: async () => "c".repeat(32) + ":" + "d".repeat(128),
      resetUserPassword: async (...args) => { calls.push(args); return "b".repeat(48); },
      sameOrigin: () => true, cookie: (value, age) => "vy_user_session=" + value + "; Max-Age=" + age
    }
  });
  const res = response();
  await handler({ method: "POST", headers: goodHeaders, body: { token: "a".repeat(64), password: "new-password-123" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "a".repeat(64));
  assert.ok(Array.isArray(res.headers["Set-Cookie"]));
  assert.match(res.body.message, /نشست‌های قبلی/);
});

test("password reset request enforces an account-level limit without revealing account existence", async () => {
  let issued = 0, mailed = 0, accountChecks = 0;
  const genericMessage = "اگر حساب فعالی با این ایمیل وجود داشته باشد، در صورت فعال‌بودن سرویس ایمیل، پیوند بازیابی ارسال خواهد شد.";
  const handler = loadHandler("handlers/users/request-password-reset.js", {
    "../../lib/quota": {
      consumeIpRateLimit: async () => ({ count: 1, limit: 3 }),
      consumeAccountRateLimit: async (uid, options) => {
        accountChecks++;
        assert.equal(uid, "b".repeat(48));
        assert.equal(options.scope, "user-password-reset-account");
        return { count: 4, limit: 3 };
      }
    },
    "../../lib/user-auth": {
      validEmail: () => true,
      getUserByEmail: async () => ({ uid: "b".repeat(48), email: "user@example.test", email_verified: true }),
      issuePasswordReset: async () => { issued++; return "a".repeat(64); },
      discardPasswordResetToken: async () => {},
      sameOrigin: () => true
    },
    "../../lib/email": {
      sendUserPasswordResetEmail: async () => { mailed++; return { sent: true }; }
    }
  });
  const res = response();
  await handler({ method: "POST", headers: goodHeaders, body: { email: "user@example.test" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, genericMessage);
  assert.equal(accountChecks, 1);
  assert.equal(issued, 0);
  assert.equal(mailed, 0);
});
