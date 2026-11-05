const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
process.env.ADMIN_API_KEY = "test-admin-key";

const values = new Map();
const lists = new Map();
const sets = new Map();
let throwAfterRefund = false;

global.fetch = async (_url, options) => {
  const command = JSON.parse(options.body);
  const [op, ...args] = command;
  let result = null;

  if (op === "GET") {
    result = values.has(args[0]) ? values.get(args[0]) : null;
  } else if (op === "SET") {
    values.set(args[0], String(args[1]));
    result = "OK";
  } else if (op === "DEL") {
    result = 0;
    for (const key of args) if (values.delete(key)) result++;
  } else if (op === "LPUSH") {
    const list = lists.get(args[0]) || [];
    list.unshift(String(args[1]));
    lists.set(args[0], list);
    result = list.length;
  } else if (op === "LTRIM") {
    const list = lists.get(args[0]) || [];
    const start = Number(args[1]);
    const end = Number(args[2]);
    lists.set(args[0], list.slice(start, end < 0 ? undefined : end + 1));
    result = "OK";
  } else if (op === "LRANGE") {
    const list = lists.get(args[0]) || [];
    const start = Number(args[1]);
    const end = Number(args[2]);
    result = list.slice(start, end < 0 ? undefined : end + 1);
  } else if (op === "EVAL" && String(args[0]).includes("KEYS[2]")) {
    const keyCount = Number(args[1]);
    const balanceKey = args[2];
    const markerKey = args[3];
    const amount = Number(args[4]);
    let balance = Number(values.get(balanceKey) || 0);
    if (!values.has(markerKey)) {
      values.set(markerKey, "1");
      balance += amount;
      values.set(balanceKey, String(balance));
      if (throwAfterRefund) {
        throwAfterRefund = false;
        throw new Error("simulated timeout after Redis applied refund");
      }
    }
    result = balance;
  } else {
    throw new Error("Unsupported test Redis command: " + op);
  }

  return { ok: true, json: async () => ({ result }) };
};

const { refundOnce } = require("../lib/quota");
const adminLawyers = require("../api/admin/lawyers");
const createQuestion = require("../api/questions/create");
const { getLawyerSession, hashToken } = require("../lib/lawyer-auth");

function responseMock() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("refundOnce is idempotent after an ambiguous Redis timeout", async () => {
  values.set("test:credits", "100");
  throwAfterRefund = true;
  const id = "a".repeat(32);

  await assert.rejects(refundOnce("test:credits", 10, id), /simulated timeout/);
  const retryBalance = await refundOnce("test:credits", 10, id);

  assert.equal(retryBalance, 110);
  assert.equal(values.get("test:credits"), "110");
});

test("refundOnce rejects invalid reservation identifiers and amounts", async () => {
  await assert.rejects(refundOnce("test:credits", 10, "bad-id"), /Invalid refund reservation/);
  await assert.rejects(refundOnce("test:credits", 0, "b".repeat(32)), /Invalid refund reservation/);
});

test("admin can disable a lawyer and the existing session and new questions are blocked", async () => {
  const lawyerId = "c".repeat(32);
  const token = "d".repeat(64);
  values.set("vy:lawyer:" + lawyerId, JSON.stringify({
    id: lawyerId, name: "وکیل آزمایشی", email: "lawyer@example.test", access: "active"
  }));
  values.set("vy:lawyer:session:" + hashToken(token), lawyerId);

  const adminRes = responseMock();
  await adminLawyers({
    method: "POST",
    headers: { authorization: "Bearer test-admin-key" },
    body: { action: "set_access", lawyer_id: lawyerId, enabled: false }
  }, adminRes);

  assert.equal(adminRes.statusCode, 200);
  assert.equal(adminRes.body.lawyer.access, "disabled");

  const auditRes = responseMock();
  await adminLawyers({ method: "POST", headers: { authorization: "Bearer test-admin-key" }, body: { action: "audit" } }, auditRes);
  assert.equal(auditRes.statusCode, 200);
  assert.ok(auditRes.body.events.some(event => event.action === "lawyer_access_disabled" && event.lawyer_id === lawyerId));

  const sessionRes = responseMock();
  const session = await getLawyerSession({ headers: { cookie: "vy_lawyer_session=" + token } }, sessionRes);
  assert.equal(session, null);
  assert.match(sessionRes.headers["Set-Cookie"], /Max-Age=0/);

  const questionRes = responseMock();
  await createQuestion({
    method: "POST",
    headers: { host: "app.example.test", origin: "https://app.example.test", "sec-fetch-site": "same-origin" },
    body: { consent: true, lawyer_id: lawyerId, question: "پرسش آزمایشی برای وکیل" }
  }, questionRes);
  assert.equal(questionRes.statusCode, 403);
});

test("admin lawyer endpoint rejects an invalid manager key", async () => {
  const res = responseMock();
  await adminLawyers({
    method: "POST",
    headers: { authorization: "Bearer wrong-key" },
    body: { action: "list" }
  }, res);
  assert.equal(res.statusCode, 401);
});
