const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRouter() {
  const source = fs.readFileSync(path.join(__dirname, "../api/index.js"), "utf8");
  const calls = [];
  const loadedRoutes = [];
  const module = { exports: null };
  const sandbox = {
    module,
    exports: module.exports,
    require(id) {
      assert.match(id, /^\.\.\/handlers\//);
      const route = id.slice("../handlers/".length).replace(/\.js$/, "");
      loadedRoutes.push(route);
      return async (req, res) => {
        calls.push({ route, req });
        return res.status(200).json({ handled: route });
      };
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "api/index.js" });
  return { handler: module.exports, calls, loadedRoutes };
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

test("API router delegates known routes without changing the request", async () => {
  const { handler, calls } = loadRouter();
  const req = { method: "POST", query: { route: "users/login" }, body: { email: "test@example.com" } };
  const res = response();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { handled: "users/login" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].req, req);
});

test("API router rejects unknown and malformed routes without loading modules", async () => {
  const { handler, calls } = loadRouter();
  for (const route of ["missing/route", "../users/login", ["users", "login"], undefined]) {
    const res = response();
    await handler({ method: "GET", query: { route } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "API route not found");
    assert.equal(res.headers["Cache-Control"], "no-store");
  }
  assert.equal(calls.length, 0);
});

test("router registers every public API endpoint and Vercel rewrites preserve URL paths", () => {
  const { loadedRoutes } = loadRouter();
  const expected = [
    "admin/grant-credits", "admin/lawyers", "chat",
    "lawyer/login", "lawyer/logout", "lawyer/me", "lawyer/questions",
    "lawyer/reply", "lawyer/resend-verification", "lawyer/verify-email",
    "lawyers/active", "questions/create", "questions/mine", "usage",
    "users/login", "users/logout", "users/me", "users/register",
    "users/resend-verification", "users/verify"
  ];
  assert.deepEqual([...loadedRoutes].sort(), [...expected].sort());

  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8"));
  assert.ok(config.rewrites.some(rule =>
    rule.source === "/api/:path*" &&
    rule.destination === "/api/index?route=:path*"
  ));
});
