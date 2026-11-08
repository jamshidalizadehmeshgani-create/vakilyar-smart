const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRouter() {
  const source = fs.readFileSync(path.join(__dirname, "../api/index.js"), "utf8");
  const calls = [];
  const module = { exports: null };
  const sandbox = {
    module,
    exports: module.exports,
    require(id) {
      assert.match(id, /^\.\.\/handlers\//);
      const route = id.slice("../handlers/".length).replace(/\.js$/, "");
      return async (req, res) => {
        calls.push({ route, req });
        return res.status(200).json({ handled: route });
      };
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "api/index.js" });
  return { handler: module.exports, calls };
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
    assert.deepEqual(res.body, { error: "API route not found" });
    assert.equal(res.headers["Cache-Control"], "no-store");
  }
  assert.equal(calls.length, 0);
});
