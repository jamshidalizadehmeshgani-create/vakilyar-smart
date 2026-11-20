const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHandler() {
  const source = fs.readFileSync(path.join(__dirname, "../handlers/users/memory.js"), "utf8");
  const lists = new Map();
  const module = { exports: null };
  const sandbox = {
    module, exports: module.exports,
    require(id) {
      if (id === "crypto") return require("node:crypto");
      if (id === "../../lib/user-auth") return {
        getUserSessionUid: async req => req.uid || "",
        sameOrigin: req => req.sameOrigin !== false
      };
      if (id === "../../lib/quota") return {
        consumeAccountRateLimit: async () => ({count:1,limit:60,windowSeconds:3600}),
        redis: async command => {
          const [op,key,...args]=command;const list=lists.get(key)||[];lists.set(key,list);
          if(op==="LPUSH"){list.unshift(args[0]);return list.length;}
          if(op==="LTRIM"){const start=Number(args[0]),end=Number(args[1]);list.splice(end+1);if(start)list.splice(0,start);return "OK";}
          if(op==="LRANGE")return list.slice(Number(args[0]),Number(args[1])+1);
          if(op==="EVAL"){
            const targetKey=args[1],id=args[2],replacement=args[3],target=lists.get(targetKey)||[];
            const index=target.findIndex(raw=>{try{return JSON.parse(raw).id===id;}catch{return false;}});
            if(index<0)return 0;
            if(replacement){const next=JSON.parse(replacement);next.created_at=JSON.parse(target[index]).created_at;target[index]=JSON.stringify(next);}
            else target.splice(index,1);
            return 1;
          }
          return "OK";
        }
      };
      throw new Error("Unexpected dependency: "+id);
    }
  };
  vm.runInNewContext(source,sandbox,{filename:"handlers/users/memory.js"});
  return {handler:module.exports,lists};
}
function response(){return {statusCode:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
test("user memory is private to the authenticated server-side account and supports CRUD",async()=>{
 const {handler,lists}=loadHandler();const uidA="a".repeat(48),uidB="b".repeat(48);
 const added=response();await handler({method:"POST",uid:uidA,body:{action:"add",title:"یادداشت من",content:"مطلب محرمانه"}},added);
 assert.equal(added.statusCode,201);
 const keyA="vy:user:"+uidA+":memory",keyB="vy:user:"+uidB+":memory";
 assert.equal(lists.get(keyA).length,1);assert.equal(lists.get(keyB),undefined);
 const listA=response();await handler({method:"POST",uid:uidA,body:{action:"list"}},listA);assert.equal(listA.body.count,1);
 const listB=response();await handler({method:"POST",uid:uidB,body:{action:"list"}},listB);assert.equal(listB.body.count,0);
 const crossUpdate=response();await handler({method:"POST",uid:uidB,body:{action:"update",id:added.body.record.id,title:"دستکاری",content:"نباید تغییر کند"}},crossUpdate);assert.equal(crossUpdate.statusCode,404);
 const crossDelete=response();await handler({method:"POST",uid:uidB,body:{action:"delete",id:added.body.record.id}},crossDelete);assert.equal(crossDelete.statusCode,404);
 const stillPrivate=response();await handler({method:"POST",uid:uidA,body:{action:"list"}},stillPrivate);assert.equal(stillPrivate.body.count,1);
 const updated=response();await handler({method:"POST",uid:uidA,body:{action:"update",id:added.body.record.id,title:"عنوان ویرایش‌شده",content:"متن جدید"}},updated);assert.equal(updated.statusCode,200);
 const after=response();await handler({method:"POST",uid:uidA,body:{action:"list"}},after);assert.equal(after.body.records[0].title,"عنوان ویرایش‌شده");
 const deleted=response();await handler({method:"POST",uid:uidA,body:{action:"delete",id:added.body.record.id}},deleted);assert.equal(deleted.statusCode,200);
 const final=response();await handler({method:"POST",uid:uidA,body:{action:"list"}},final);assert.equal(final.body.count,0);
});
test("user memory rejects anonymous, cross-origin, invalid and oversized requests",async()=>{
 const {handler}=loadHandler();const anonymous=response();await handler({method:"POST",uid:"",body:{action:"list"}},anonymous);assert.equal(anonymous.statusCode,401);
 const cross=response();await handler({method:"POST",uid:"a".repeat(48),sameOrigin:false,body:{action:"list"}},cross);assert.equal(cross.statusCode,403);
 const invalid=response();await handler({method:"POST",uid:"a".repeat(48),body:{action:"add",title:"",content:""}},invalid);assert.equal(invalid.statusCode,400);
 const oversized=response();await handler({method:"POST",uid:"a".repeat(48),body:{action:"add",title:"x".repeat(121),content:"ok"}},oversized);assert.equal(oversized.statusCode,400);
});


test("private memory derives identity from the real HttpOnly session and ignores client UID fields", async () => {
  const auth = require("../lib/user-auth");
  const handler = require("../handlers/users/memory");
  const originalFetch = global.fetch;
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    secret: process.env.APP_SECRET
  };
  const uidA = "a".repeat(48), uidB = "b".repeat(48);
  const tokenA = "1".repeat(64), tokenB = "2".repeat(64);
  const store = new Map(), lists = new Map(), rateCounts = new Map();
  store.set("vy:user:session:" + auth.hash(tokenA), uidA + ":0");
  store.set("vy:user:session:" + auth.hash(tokenB), uidB + ":0");
  store.set("vy:user:account:" + uidA, JSON.stringify({ uid: uidA, session_version: 0 }));
  store.set("vy:user:account:" + uidB, JSON.stringify({ uid: uidB, session_version: 0 }));
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  process.env.APP_SECRET = "test-secret-for-user-memory-session-integration";
  global.fetch = async (_url, options) => {
    const command = JSON.parse(options.body);
    const [op, key, ...args] = command;
    let result = null;
    if (op === "GET") {
      result = store.get(key) ?? (lists.has(key) ? lists.get(key) : null);
    } else if (op === "EVAL" && command[1].includes("VY_ACCOUNT_RATE_LIMIT")) {
      const count = (rateCounts.get(key) || 0) + 1;
      rateCounts.set(key, count);
      result = count;
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
    } else if (op === "EVAL" && command[1].includes("LSET")) {
      const list = lists.get(command[3]) || [];
      const id = command[4], replacement = command[5];
      const index = list.findIndex(raw => { try { return JSON.parse(raw).id === id; } catch { return false; } });
      if (index >= 0) {
        const next = JSON.parse(replacement);
        next.created_at = JSON.parse(list[index]).created_at;
        list[index] = JSON.stringify(next);
        result = 1;
      } else result = 0;
    } else {
      throw new Error("Unexpected Redis command in session integration test: " + op);
    }
    return { ok: true, status: 200, json: async () => ({ result }) };
  };

  const makeReq = (token, body) => ({
    method: "POST",
    headers: {
      host: "preview.example.test",
      origin: "https://preview.example.test",
      cookie: auth.SESSION_COOKIE + "=" + token
    },
    body
  });
  try {
    const added = response();
    await handler(makeReq(tokenA, {
      action: "add", title: "یادداشت حساب الف", content: "محرمانه",
      uid: uidB, user_id: uidB, account_id: uidB
    }), added);
    assert.equal(added.statusCode, 201);
    const id = added.body.record.id;
    const keyA = "vy:user:" + uidA + ":memory";
    const keyB = "vy:user:" + uidB + ":memory";
    assert.equal(lists.get(keyA).length, 1);
    assert.equal(lists.has(keyB), false);

    const listB = response();
    await handler(makeReq(tokenB, { action: "list", uid: uidA, user_id: uidA }), listB);
    assert.equal(listB.statusCode, 200);
    assert.equal(listB.body.count, 0);

    const attackUpdate = response();
    await handler(makeReq(tokenB, {
      action: "update", id, title: "دستکاری حساب ب", content: "نباید تغییر کند", uid: uidA
    }), attackUpdate);
    assert.equal(attackUpdate.statusCode, 404);

    const attackDelete = response();
    await handler(makeReq(tokenB, { action: "delete", id, user_id: uidA }), attackDelete);
    assert.equal(attackDelete.statusCode, 404);

    const listA = response();
    await handler(makeReq(tokenA, { action: "list", uid: uidB }), listA);
    assert.equal(listA.body.count, 1);
    assert.equal(listA.body.records[0].title, "یادداشت حساب الف");
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
    if (previous.secret === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = previous.secret;
  }
});
