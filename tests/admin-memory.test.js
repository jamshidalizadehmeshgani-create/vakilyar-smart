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
