const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function loadHandler() {
  const source = fs.readFileSync(path.join(__dirname, "../lib/api-handlers/lawyer/verify-email.js"), "utf8");
  let redisCalls = 0;
  const module = { exports: null };
  const auth = {
    sameOrigin: req => req.headers?.origin === "https://vakilyar.example" && req.headers?.host === "vakilyar.example"
  };
  const sandbox = {
    module, exports: module.exports,
    require(id) {
      if (id === "crypto") return crypto;
      if (id === "../../../lib/quota") return { redis: async () => { redisCalls++; return null; } };
      if (id === "../../../lib/email") return { sendWelcomeEmail: async () => ({ sent: false }) };
      if (id === "../../../lib/user-auth") return auth;
      throw new Error("Unexpected module: " + id);
    },
    process: { env: {} }, Date, console
  };
  vm.runInNewContext(source, sandbox, { filename: "lib/api-handlers/lawyer/verify-email.js" });
  return { handler: module.exports, getRedisCalls: () => redisCalls };
}

function response() {
  return {
    headers: {}, statusCode: 200, body: "",
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; }
  };
}

test("opening a lawyer verification link only renders a confirmation form", async () => {
  const { handler, getRedisCalls } = loadHandler();
  const res = response();
  const token = "a".repeat(64);
  await handler({ method: "GET", query: { token }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /method="post"/i);
  assert.match(res.body, /بازکردن این صفحه به‌تنهایی ایمیل شما را تأیید نمی‌کند/);
  assert.equal(getRedisCalls(), 0);
});

test("lawyer verification POST rejects cross-origin requests before touching Redis", async () => {
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

test("lawyer verification rejects unsupported methods", async () => {
  const { handler, getRedisCalls } = loadHandler();
  const res = response();
  await handler({ method: "DELETE", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, POST");
  assert.equal(getRedisCalls(), 0);
});
