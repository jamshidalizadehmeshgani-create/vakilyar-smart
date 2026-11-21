"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateIntake } = require("../lib/legal-intake-validation");

const inputPath = path.resolve(process.cwd(), process.argv[2] || "legal/intake.json");
let intake;
try {
  intake = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (error) {
  console.error("خواندن یا تجزیه پرونده دریافت ناموفق بود: " + error.message);
  process.exitCode = 1;
}

if (intake !== undefined) {
  const result = validateIntake(intake);
  if (!result.valid) {
    console.error("پرونده برای ورود به بانک حقوقی تأیید نشد:");
    for (const error of result.errors) console.error("- " + error);
    process.exitCode = 1;
  } else {
    console.log("کنترل ساختاری پرونده دریافت موفق بود. انتقال به corpus همچنان نیازمند ثبت جداگانه و بازبینی نهایی است.");
  }
}
