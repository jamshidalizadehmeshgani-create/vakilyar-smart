const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("public/ask-lawyer.html", "utf8");

test("lawyer question form explains when no active lawyers exist", () => {
  assert.match(html, /در حال حاضر وکیل فعالی برای دریافت پرسش ثبت نشده است/);
  assert.match(html, /send\.disabled=true/);
  assert.match(html, /d\.lawyers\.length===0/);
});

test("lawyer question form fails closed when lawyer list cannot be loaded", () => {
  assert.match(html, /فهرست وکلا موقتاً در دسترس نیست/);
  assert.match(html, /\$\("lawyer"\)\.disabled=true/);
  assert.match(html, /\$\("send"\)\.disabled=true/);
});

test("lawyer question form sends and persists an idempotency key", () => {
  assert.match(html, /vy_pending_question/);
  assert.match(html, /request_id:pendingQuestion\.id/);
});
