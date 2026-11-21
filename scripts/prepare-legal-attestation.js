"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildAttestationMessage } = require("../lib/legal-human-attestation");
const { normalizeAsOfDate } = require("../lib/jalali-date");

function main(args) {
  if (args.length !== 5) {
    throw new Error("استفاده: node scripts/prepare-legal-attestation.js <intake.json> <reviewer|approver> <identityId> <keyId> <signedAt-UTC>");
  }
  const [file, role, identityId, keyId, signedAt] = args;
  const intakePath = path.resolve(process.cwd(), file);
  const intake = JSON.parse(fs.readFileSync(intakePath, "utf8"));
  if (!["reviewer", "approver"].includes(role) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(identityId) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(keyId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(signedAt) ||
      !Number.isFinite(Date.parse(signedAt)) ||
      new Date(Date.parse(signedAt)).toISOString() !== signedAt ||
      Date.parse(signedAt) > Date.now()) {
    throw new Error("نقش، شناسه هویت/کلید یا زمان امضای UTC معتبر نیست.");
  }
  const reviewDate = normalizeAsOfDate(intake?.legalReview?.reviewedAt);
  const approvalDate = normalizeAsOfDate(intake?.promotion?.approvedAt);
  if (!reviewDate || !approvalDate || approvalDate < reviewDate ||
      signedAt.slice(0, 10) < reviewDate || signedAt.slice(0, 10) > approvalDate) {
    throw new Error("زمان امضا باید در بازه تاریخ بازبینی حقوقی تا تأیید نهایی باشد.");
  }
  process.stdout.write(buildAttestationMessage(intake, role, identityId, keyId, signedAt));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error("ساخت پیام امضای حقوقی ناموفق بود: " + error.message);
  process.exitCode = 1;
}
