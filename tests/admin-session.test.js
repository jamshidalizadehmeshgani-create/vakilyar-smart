"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function loadAuth() {
  const source = fs.readFileSync(path.join(__dirname, "../lib/admin-auth.js"), "utf8");
  const store = new Map();
  const calls = [];
  const module = { exports: null };
  const sandbox = {
    module, exports: module.exports, process: { env: { ADMIN_API_KEY: "preview-test-key" } },
    Buffer, URL, console,
    require(id) {
      if (id === "crypto") return crypto;
      if (id === "./quota") return {
        consumeIpRateLimit: async () => ({ count: 1, limit: 8, windowSeconds: 900 }),
        redis: async command => {
          calls.push(command);
          const [op, key, value] = command;
          if (op === "SET") { store.set(key, value); return "OK"; }
          if (op === "GET") return store.get(key) || null;
          if (op === "DEL") return store.delete(key) ? 1 : 0;
          throw new Error("Unexpected Redis operation: " + op);
        }
      };
      throw new Error("Unexpected dependency: " + id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "lib/admin-auth.js" });
  return { auth: module.exports, store, calls };
}
function response() {
  return { statusCode: 200, headers: {}, body: null,
    setHeader(k,v){this.headers[k]=v;}, status(n){this.statusCode=n;return this;},
    json(v){this.body=v;return this;} };
}
const req = (extra={}) => ({ method:"POST", headers:{
  host:"preview.example.test", origin:"https://preview.example.test",
  "sec-fetch-site":"same-origin", "x-real-ip":"192.0.2.10", ...extra
}, body:{} });

test("owner login exchanges the bootstrap key for a short-lived HttpOnly session", async () => {
  const { auth, store, calls } = loadAuth();
  const res = response();
  assert.equal(await auth.loginAdmin(req(), Object.assign(res, {})), false);
  const loginReq = req(); loginReq.body = { key:"preview-test-key" };
  assert.equal(await auth.loginAdmin(loginReq, res), true);
  const setCookie = res.headers["Set-Cookie"];
  assert.match(setCookie, /^vy_owner_session=[a-f0-9]{64};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  const token = setCookie.match(/^vy_owner_session=([a-f0-9]{64})/)[1];
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  assert.equal(store.get("vy:admin:session:" + digest), "owner");
  assert.equal(calls.some(c => c[0] === "SET" && c[3] === "43200"), true);
});

test("owner session authorization ignores browser-supplied UID and logout revokes it", async () => {
  const { auth, store } = loadAuth();
  const loginRes = response();
  const loginReq = req(); loginReq.body = { key:"preview-test-key" };
  await auth.loginAdmin(loginReq, loginRes);
  const token = loginRes.headers["Set-Cookie"].match(/^vy_owner_session=([a-f0-9]{64})/)[1];
  const authReq = req({ cookie:"vy_owner_session="+token+"; vy_uid=attacker-controlled" });
  const authRes = response();
  assert.equal(await auth.authorizeAdmin(authReq, authRes), true);
  const logoutRes = response();
  assert.equal(await auth.logoutAdmin(authReq, logoutRes), true);
  assert.match(logoutRes.headers["Set-Cookie"], /Max-Age=0/);
  const denied = response();
  assert.equal(await auth.authorizeAdmin(authReq, denied), false);
  assert.equal(denied.statusCode, 401);
  assert.equal([...store.keys()].some(k => k.startsWith("vy:admin:session:")), false);
});

test("owner session rejects invalid origin and wrong bootstrap key", async () => {
  const { auth } = loadAuth();
  const badOrigin = req({ origin:"https://attacker.example.test" });
  const badOriginRes = response();
  assert.equal(await auth.loginAdmin(badOrigin, badOriginRes), false);
  assert.equal(badOriginRes.statusCode, 403);
  const wrong = req(); wrong.body = { key:"wrong" };
  const wrongRes = response();
  assert.equal(await auth.loginAdmin(wrong, wrongRes), false);
  assert.equal(wrongRes.statusCode, 401);
});
