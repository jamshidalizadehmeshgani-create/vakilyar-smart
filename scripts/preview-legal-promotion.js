"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { promoteApprovedIntake } = require("../lib/legal-intake-promotion");

const intakePath = path.resolve(process.cwd(), process.argv[2] || "legal/intake.json");
const corpusPath = path.resolve(process.cwd(), process.argv[3] || "legal/corpus.json");

try {
  const intake = JSON.parse(fs.readFileSync(intakePath, "utf8"));
  const existingCorpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
  const result = promoteApprovedIntake(intake, { existingCorpus });
  if (!result.valid) {
    console.error("پیش‌نمایش ورود به بانک رد شد:");
    for (const error of result.errors) console.error("- " + error);
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify(result.records, null, 2) + "\n");
    console.error(result.notice);
  }
} catch (error) {
  console.error("ساخت پیش‌نمایش ناموفق بود: " + error.message);
  process.exitCode = 1;
}
