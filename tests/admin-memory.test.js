const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHandler({ authorized = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../handlers/admin/memory.js"), "utf8");
  const lists = new Map();
  const memory = lists.get("vy:admin:owner-memory") || [];
  const module = { exports: null };
  const sandbox = {
    module, exports: module.exports,
    require(id) {
      if (id === "crypto") return require("node:crypto");
      if (id === "../../lib/admin-auth") return { authorizeAdmin: async (_req, res) => {
        if (!authorized) res.status(401).json({ error: "unauthorized" });
        return authorized;
      }};
      if (id === "../../lib/quota") return { redis: async command => {
        const [op, key, ...args] = command;
        const list = lists.get(key) || [];
        lists.set(key, list);
        if (op === "LPUSH") { list.unshift(args[0]); return list.length; }
        if (op === "LTRIM") { const start = Number(args[0]), end = Number(args[1]); list.splice(end + 1); if (start) list.splice(0, start); return "OK"; }
        if (op === "LRANGE") return list.slice(Number(args[0]), Number(args[1]) + 1);
        if (op === "EVAL") {
          const targetKey = args[1], id = args[2], target = lists.get(targetKey) || [];
          const index = target.findIndex(raw => { try { return JSON.parse(raw).id === id; } catch { return false; } });
          if (index < 0) return 0;
          target.splice(index, 1); return 1;
        }
        return "OK";
      }};
      throw new Error("Unexpected dependency: " + id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "handlers/admin/memory.js" });
  return { handler: module.exports, memory: lists.get("vy:admin:owner-memory") || [] };
}
function response() {
  return { statusCode: 200, body: null, headers: {},
    setHeader(k,v){this.headers[k]=v;}, status(n){this.statusCode=n;return this;},
    json(v){this.body=v;return this;} };
}
test("owner memory is authorized, persistent in Redis list, and supports list/delete", async () => {
  const { handler } = loadHandler();
  const add = response();
  await handler({ method:"POST", body:{action:"add",title:"تصمیم پروژه",content:"یادداشت خصوصی",category:"تصمیم مدیریتی"} }, add);
  assert.equal(add.statusCode,201);
  const list = response();
  await handler({ method:"POST", body:{action:"list"} }, list);
  assert.equal(list.body.count,1);
  assert.equal(list.body.records[0].content,"یادداشت خصوصی");
  const remove = response();
  await handler({ method:"POST", body:{action:"delete",id:add.body.record.id} }, remove);
  assert.equal(remove.statusCode,200);
  const afterDelete = response();
  await handler({ method:"POST", body:{action:"list"} }, afterDelete);
  assert.equal(afterDelete.body.count,0);
});
test("owner memory rejects unauthorized requests and oversized notes", async () => {
  const blocked = loadHandler({authorized:false});
  const denied = response();
  await blocked.handler({method:"POST",body:{action:"list"}},denied);
  assert.equal(denied.statusCode,401);
  const allowed = loadHandler();
  const invalid = response();
  await allowed.handler({method:"POST",body:{action:"add",title:"x".repeat(121),content:"text"}},invalid);
  assert.equal(invalid.statusCode,400);
});


test("real owner session handler protects the owner-memory API and logout revokes access", async () => {
  const sessionHandler = require("../handlers/admin/session");
  const memoryHandler = require("../handlers/admin/memory");
  const originalFetch = global.fetch;
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    secret: process.env.APP_SECRET,
    adminKey: process.env.ADMIN_API_KEY,
    username: process.env.ADMIN_USERNAME,
    passwordHash: process.env.ADMIN_PASSWORD_HASH
  };
  const store = new Map(), lists = new Map(), counters = new Map();
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  process.env.APP_SECRET = "test-secret-for-owner-memory-session-integration";
  process.env.ADMIN_API_KEY = "bootstrap-test-key";
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD_HASH;
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    const [op, key, ...args] = command;
    let result = null;
    if (op === "EVAL" && command[1].includes("VY_IP_RATE_LIMIT")) {
      const count = (counters.get(args[0]) || 0) + 1;
      counters.set(args[0], count);
      result = count;
    } else if (op === "SET") {
      store.set(key, args[0]);
      result = "OK";
    } else if (op === "GET") {
      result = store.get(key) ?? null;
    } else if (op === "DEL") {
      result = store.delete(key) ? 1 : 0;
    } else if (op === "LPUSH") {
      const list = lists.get(key) || [];
      list.unshift(args[0]);
      lists.set(key, list);
      result = list.length;
    } else if (op === "LTRIM") {
      const list = lists.get(key) || [];
      list.splice(Number(args[1]) + 1);
      if (Number(args[0]) > 0) list.splice(0, Number(args[0]));
      lists.set(key, list);
      result = "OK";
    } else if (op === "LRANGE") {
      const list = lists.get(key) || [];
      result = list.slice(Number(args[0]), Number(args[1]) + 1);
    } else if (op === "EVAL" && command[1].includes("LREM")) {
      const list = lists.get(command[3]) || [];
      const id = command[4];
      const index = list.findIndex(raw => { try { return JSON.parse(raw).id === id; } catch { return false; } });
      if (index >= 0) { list.splice(index, 1); result = 1; } else result = 0;
    } else {
      throw new Error("Unexpected Redis command in owner-memory integration test: " + op);
    }
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  const makeReq = (body, cookie = "") => ({
    method: "POST",
    headers: {
      host: "preview.example.test",
      origin: "https://preview.example.test",
      "x-real-ip": "192.0.2.45",
      ...(cookie ? { cookie } : {})
    },
    body
  });
  try {
    const login = response();
    await sessionHandler(makeReq({ action: "login", key: "bootstrap-test-key" }), login);
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["Set-Cookie"];
    assert.match(setCookie, /^vy_owner_session=[a-f0-9]{64};/);
    const cookie = setCookie.split(";")[0];

    const add = response();
    await memoryHandler(makeReq({
      action: "add", title: "یادداشت مالک", content: "اطلاعات خصوصی پروژه"
    }, cookie), add);
    assert.equal(add.statusCode, 201);

    const anonymous = response();
    await memoryHandler(makeReq({ action: "list" }), anonymous);
    assert.equal(anonymous.statusCode, 401);

    const list = response();
    await memoryHandler(makeReq({ action: "list" }, cookie), list);
    assert.equal(list.statusCode, 200);
    assert.equal(list.body.records[0].content, "اطلاعات خصوصی پروژه");

    const logout = response();
    await sessionHandler(makeReq({ action: "logout" }, cookie), logout);
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers["Set-Cookie"], /Max-Age=0/);

    const afterLogout = response();
    await memoryHandler(makeReq({ action: "list" }, cookie), afterLogout);
    assert.equal(afterLogout.statusCode, 401);
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
    if (previous.secret === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = previous.secret;
    if (previous.adminKey === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = previous.adminKey;
    if (previous.username === undefined) delete process.env.ADMIN_USERNAME; else process.env.ADMIN_USERNAME = previous.username;
    if (previous.passwordHash === undefined) delete process.env.ADMIN_PASSWORD_HASH; else process.env.ADMIN_PASSWORD_HASH = previous.passwordHash;
  }
});
