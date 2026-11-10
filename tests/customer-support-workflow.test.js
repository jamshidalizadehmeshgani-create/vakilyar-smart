const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");

const read = path => fs.readFileSync(path, "utf8");

test("support requests use the authenticated account UID or signed guest UID and are rate limited", () => {
  const source = read("handlers/support/request.js");
  assert.match(source, /consumeIpRateLimit/);
  assert.match(source, /originHost !== host/);
  assert.match(source, /sec-fetch-site/);
  assert.match(source, /getUserSessionUid\(req\)/);
  assert.match(source, /getUid\(req, res\)/);
  assert.match(source, /vy:support:inbox/);
  assert.match(source, /7776000/);
});

test("administrator decisions are restricted to pending cases and audited atomically", () => {
  const source = read("handlers/admin/support-cases.js");
  assert.match(source, /authorizeAdmin/);
  assert.match(source, /item\.status~='pending'/);
  assert.match(source, /decision === "reopen"/);
  assert.match(source, /redis\.call\('DEL',statusKey\)/);
  assert.match(source, /vy:admin:audit/);
});

test("suspended accounts are blocked from quota and chat endpoints with support guidance", () => {
  const quota = read("lib/quota.js");
  const chat = read("handlers/chat.js");
  const usage = read("handlers/usage.js");
  const questionCreate = read("handlers/questions/create.js");
  const questionMine = read("handlers/questions/mine.js");
  assert.match(quota, /vy:user:\$\{uid\}:status/);
  assert.match(quota, /ACCOUNT_SUSPENDED/);
  assert.match(chat, /ACCOUNT_SUSPENDED/);
  assert.match(usage, /ACCOUNT_SUSPENDED/);
  assert.match(questionCreate, /ACCOUNT_SUSPENDED/);
  assert.match(questionMine, /ACCOUNT_SUSPENDED/);
});

test("customer and administrator support pages expose the workflow", () => {
  const customer = read("public/support.html");
  const admin = read("public/admin-support.html");
  const home = read("public/index.html");
  assert.match(customer, /\/api\/support\/request/);
  assert.match(admin, /\/api\/admin\/support-cases/);
  assert.match(admin, /decision,label/);
  assert.match(home, /\/support\.html/);
});


test("support tickets use the authenticated account identity so admin suspension targets the correct account", async () => {
  const source = read("handlers/support/request.js");

  async function submit(sessionUid, guestUid) {
    const redisCalls = [];
    let guestUidCalls = 0;
    const module = { exports: null };
    const sandbox = {
      module,
      exports: module.exports,
      URL,
      Date,
      console,
      require(id) {
        if (id === "crypto") return crypto;
        if (id === "../../lib/quota") {
          return {
            getUid() { guestUidCalls++; return guestUid; },
            consumeIpRateLimit: async () => ({ count: 1, limit: 5, windowSeconds: 3600 }),
            redis: async args => { redisCalls.push(args); return "1"; }
          };
        }
        if (id === "../../lib/user-auth") {
          return { getUserSessionUid: async () => sessionUid };
        }
        throw new Error("Unexpected module: " + id);
      }
    };
    vm.runInNewContext(source, sandbox, { filename: "handlers/support/request.js" });

    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }
    };
    await module.exports({
      method: "POST",
      headers: {
        host: "app.example.test",
        origin: "https://app.example.test",
        "sec-fetch-site": "same-origin"
      },
      body: { category: "account", message: "برای ورود به حساب مشکل دارم" }
    }, res);

    assert.equal(res.statusCode, 201);
    const storedCase = JSON.parse(redisCalls[0][5]);
    return { storedUid: storedCase.user_id, guestUidCalls };
  }

  const signedIn = await submit("a".repeat(48), "b".repeat(48));
  assert.equal(signedIn.storedUid, "a".repeat(48));
  assert.equal(signedIn.guestUidCalls, 0);

  const guest = await submit("", "c".repeat(48));
  assert.equal(guest.storedUid, "c".repeat(48));
  assert.equal(guest.guestUidCalls, 1);
});
