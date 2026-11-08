const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXPECTED_ROUTES = [
  "admin/grant-credits",
  "admin/lawyers",
  "chat",
  "lawyer/login",
  "lawyer/logout",
  "lawyer/me",
  "lawyer/questions",
  "lawyer/reply",
  "lawyer/resend-verification",
  "lawyer/verify-email",
  "lawyers/active",
  "questions/create",
  "questions/mine",
  "usage",
  "users/login",
  "users/logout",
  "users/me",
  "users/register",
  "users/resend-verification",
  "users/verify"
];

function loadRouter() {
  const calls = [];
  const module = { exports: null };
  const sandbox = {
    module,
    exports: module.exports,
    Object,
    require(id) {
      if (!id.startsWith("../lib/api-handlers/")) throw new Error("Unexpected module: " + id);
      return async (req, res) => {
        calls.push({ id, req });
        return res.status(204).json({ handled: id });
      };
    }
  };
  const source = fs.readFileSync(path.join(__dirname, "../api/router.js"), "utf8");
  vm.runInNewContext(source, sandbox, { filename: "api/router.js" });
  return { router: module.exports, calls };
}

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("central router registers every legacy API path exactly once", () => {
  const { router } = loadRouter();
  assert.deepEqual(Object.keys(router.routes).sort(), [...EXPECTED_ROUTES].sort());
  assert.equal(Object.keys(router.routes).length, 20);
});

test("central router dispatches the original request object to the exact handler", async () => {
  const { router, calls } = loadRouter();
  const req = { method: "POST", query: { __vy_route: "users/login", next: "dashboard" }, body: { email: "a@example.test" }, headers: { cookie: "session=test" } };
  const res = response();
  await router(req, res);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "../lib/api-handlers/users/login");
  assert.equal(calls[0].req, req);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("central router rejects unknown or ambiguous route selectors", async () => {
  for (const route of ["missing/route", ["users/login", "admin/lawyers"], undefined]) {
    const { router, calls } = loadRouter();
    const res = response();
    await router({ method: "GET", query: { __vy_route: route } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(calls.length, 0);
  }
});
