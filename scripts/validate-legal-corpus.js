"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateCorpus } = require("../lib/legal-corpus-validation");

const inputPath = path.resolve(process.cwd(), process.argv[2] || "legal/corpus.json");
let corpus;
try {
  corpus = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (error) {
  console.error("خواندن یا تجزیه بانک حقوقی ناموفق بود: " + error.message);
  process.exitCode = 1;
  return;
}

const result = validateCorpus(corpus);
if (!result.valid) {
  console.error("اعتبارسنجی بانک حقوقی ناموفق است.");
  for (const error of result.errors) console.error("- " + error);
  console.error(result.validRecords + " از " + result.total + " رکورد معتبر است.");
  process.exitCode = 1;
} else if (result.total === 0) {
  console.log("ساختار بانک معتبر است، اما بانک خالی است؛ هیچ منبع حقوقی برای استناد در دسترس نیست.");
} else {
  console.log("بانک حقوقی معتبر است: " + result.validRecords + " رکورد از " + result.total +
    " رکورد؛ تاریخ مبنا: " + result.asOfDate);
}
