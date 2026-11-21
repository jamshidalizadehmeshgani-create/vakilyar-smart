"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildAttestationMessage } = require("../lib/legal-human-attestation");

function main(args) {
  if (args.length !== 5) {
    throw new Error("استفاده: node scripts/prepare-legal-attestation.js <intake.json> <reviewer|approver> <identityId> <keyId> <signedAt-UTC>");
  }
  const [file, role, identityId, keyId, signedAt] = args;
  const intakePath = path.resolve(process.cwd(), file);
  const intake = JSON.parse(fs.readFileSync(intakePath, "utf8"));
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(signedAt) ||
      !Number.isFinite(Date.parse(signedAt)) || Date.parse(signedAt) > Date.now()) {
    throw new Error("زمان امضا باید UTC معتبر و در گذشته یا زمان حال باشد.");
  }
  process.stdout.write(buildAttestationMessage(intake, role, identityId, keyId, signedAt));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error("ساخت پیام امضای حقوقی ناموفق بود: " + error.message);
  process.exitCode = 1;
}
