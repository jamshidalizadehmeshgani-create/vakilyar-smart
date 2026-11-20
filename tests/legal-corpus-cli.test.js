"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cli = path.join(__dirname, "..", "scripts", "validate-legal-corpus.js");

function runWithJson(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vakilyar-corpus-"));
  const file = path.join(dir, "corpus.json");
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  try {
    return spawnSync(process.execPath, [cli, file], { encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI reports an empty corpus as structurally valid but not evidence-ready", () => {
  const result = runWithJson([]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /بانک خالی است/);
});

test("CLI exits nonzero for a non-array JSON root", () => {
  const result = runWithJson({ records: [] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /اعتبارسنجی بانک حقوقی ناموفق است/);
});

test("CLI exits nonzero and explains malformed JSON", () => {
  const result = runWithJson("{ invalid json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /خواندن یا تجزیه بانک حقوقی ناموفق بود/);
});
