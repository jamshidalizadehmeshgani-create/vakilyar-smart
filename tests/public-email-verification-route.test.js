const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHandler() {
  const source = fs.readFileSync(path.join(__dirname, "../lib/api-handlers/users/verify.js"), "utf8");
  let redisCalls = 0;
  const module = { exports: null };
  const auth = {
    hash: value => "hashed-" + value,
    redis: async () => { redisCalls++; return null; },
    sameOrigin: req => req.headers?.origin === "https://vakilyar.example" && req.headers?.host === "vakilyar.example"
  };
  const sandbox = {
    module,
    exports: module.exports,
    require(id) {
      if (id === "../../../lib/user-auth") return auth;
      if (id === "../../../lib/email") return { sendWelcomeEmail: async () => ({ sent: false }) };
      if (id === "../../../lib/referrals") return { REFERRAL_REWARD: 250, REFERRAL_MAX_REWARDS: 5 };
      throw new Error("Unexpected module: " + id);
    },
    process: { env: {} },
    Date,
    console
  };
  vm.runInNewContext(source, sandbox, { filename: "lib/api-handlers/users/verify.js" });
  return { handler: module.exports, getRedisCalls: () => redisCalls };
}

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; }
  };
}

test("opening an email verification link does not consume or verify its token", async () => {
  const { handler, getRedisCalls } = loadHandler();
  const res = response();
  const token = "a".repeat(64);
  await handler({ method: "GET", query: { token }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /method="post"/i);
  assert.match(res.body, /بازکردن این صفحه به‌تنهایی حساب شما را فعال نمی‌کند/);
  assert.equal(getRedisCalls(), 0);
});

test("email verification POST rejects cross-origin requests before touching Redis", async () => {
  const { handler, getRedisCalls } = loadHandler();
  const res = response();
  await handler({
    method: "POST",
    body: { token: "b".repeat(64) },
    headers: { host: "vakilyar.example", origin: "https://attacker.example" }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(getRedisCalls(), 0);
});
