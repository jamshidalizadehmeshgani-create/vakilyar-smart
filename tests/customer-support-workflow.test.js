const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = path => fs.readFileSync(path, "utf8");

test("support requests are authenticated to the signed guest UID and rate limited", () => {
  const source = read("api/support/request.js");
  assert.match(source, /consumeIpRateLimit/);
  assert.match(source, /getUid\(req, res\)/);
  assert.match(source, /vy:support:inbox/);
  assert.match(source, /7776000/);
});

test("administrator decisions are restricted to pending cases and audited atomically", () => {
  const source = read("api/admin/support-cases.js");
  assert.match(source, /authorizeAdmin/);
  assert.match(source, /item\.status~='pending'/);
  assert.match(source, /decision === "reopen"/);
  assert.match(source, /redis\.call\('DEL',statusKey\)/);
  assert.match(source, /vy:admin:audit/);
});

test("suspended accounts are blocked from quota and chat endpoints with support guidance", () => {
  const quota = read("lib/quota.js");
  const chat = read("api/chat.js");
  const usage = read("api/usage.js");
  const questionCreate = read("api/questions/create.js");
  const questionMine = read("api/questions/mine.js");
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
