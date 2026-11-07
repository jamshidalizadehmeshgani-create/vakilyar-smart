const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Vercel security headers enforce same-origin isolation and disable legacy cross-domain policies", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8"));
  const rules = config.headers || [];
  const headers = rules.flatMap(rule => rule.headers || []);
  const values = new Map(headers.map(header => [String(header.key).toLowerCase(), header.value]));

  assert.equal(values.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(values.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(values.get("x-permitted-cross-domain-policies"), "none");
});
