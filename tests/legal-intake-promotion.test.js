"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { promoteApprovedIntake } = require("../lib/legal-intake-promotion");
const { REGISTRY_ENV, buildAttestationMessage } = require("../lib/legal-human-attestation");

const identities = [
  { identityId: "reviewer-a", keyId: "reviewer-a-v1", displayName: "بازبین الف", role: "reviewer" },
  { identityId: "reviewer-b", keyId: "reviewer-b-v1", displayName: "بازبین ب", role: "reviewer" },
  { identityId: "approver-a", keyId: "approver-a-v1", displayName: "تأییدکننده الف", role: "approver" },
  { identityId: "approver-b", keyId: "approver-b-v1", displayName: "تأییدکننده ب", role: "approver" }
].map(identity => ({ ...identity, ...crypto.generateKeyPairSync("ed25519") }));

process.env[REGISTRY_ENV] = JSON.stringify(identities.map(identity => ({
  identityId: identity.identityId, keyId: identity.keyId, displayName: identity.displayName,
  role: identity.role, active: true,
  publicKeyPem: identity.publicKey.export({ type: "spki", format: "pem" })
})));

function signIntake(candidate, signedAt = new Date(Date.now() - 60_000).toISOString()) {
  const signaturesFor = role => identities.filter(identity => identity.role === role).map(identity => ({
    identityId: identity.identityId, keyId: identity.keyId, signedAt,
    signature: crypto.sign(null, Buffer.from(buildAttestationMessage(candidate, role, identity.identityId, identity.keyId, signedAt)), identity.privateKey).toString("base64")
  }));
  candidate.humanAttestations = { scheme: "Ed25519", reviewerSignatures: signaturesFor("reviewer"), approverSignatures: signaturesFor("approver") };
  return candidate;
}
function runPromotion(candidate, options = {}) {
  return promoteApprovedIntake(signIntake(candidate), options);
}
const intake = {
  schemaVersion: 1,
  recordStatus: "approved_for_corpus",
  document: {
    title: "قانون آزمایشی برای آزمون گردش کار",
    sourceType: "law",
    officialPublisher: "مرجع رسمی آزمایشی",
    officialDocumentId: "official-law-001",
    approvalOrIssueDate: "2020-01-01",
    officialPublicationDate: "2020-01-02",
    officialSourcePageUrl: "https://qavanin.ir/Law/TreeText/1",
    officialDownloadUrl: "https://qavanin.ir/Pdfs/1.pdf",
    retrievedAtUtc: "2026-11-20T10:00:00Z",
    redirectChain: ["https://qavanin.ir/Pdfs/1.pdf"],
    retrievedBy: "اپراتور",
    originalFilename: "law.pdf",
    mimeType: "application/pdf",
    byteLength: 1000,
    pageCount: 3,
    sha256: "a".repeat(64),
    licenseOrReuseBasis: "مجوز آزمایشی",
    licenseEvidenceUrl: "https://qavanin.ir/license"
  },
  integrityChecks: {
    downloadedFromOfficialHost: true,
    redirectChainRecorded: true,
    fileOpensWithoutRepair: true,
    pageCountRecorded: true,
    documentIdentityMatchesOfficialMetadata: true,
    sha256RecomputedBySecondReviewer: true,
    completeDocumentConfirmed: true
  },
  legalReview: {
    reviewedBy: ["بازبین الف", "بازبین ب"],
    reviewedAt: "2026-11-20",
    articleRangeReviewed: "تمام مواد",
    articleNumberingChecked: true,
    textComparedWithOfficialPublication: true,
    amendmentsCheckedThrough: "2026-11-20",
    explicitRepealsChecked: true,
    effectiveDatesChecked: true,
    transitionalRulesChecked: true,
    unresolvedDiscrepancies: [],
    reviewOutcome: "approved"
  },
  amendmentDocuments: [],
  articleChecks: [{
    corpusRecordId: "law-001-article-1",
    articleNumber: "ماده ۱",
    text: "متن آزمایشی ماده برای آزمون تبدیل پرونده به رکورد بانک حقوقی.",
    status: "in_force",
    effectiveFrom: "2020-01-03",
    effectiveTo: null,
    unresolvedDiscrepancies: []
  }],
  promotion: {
    approvedForCorpus: true,
    approvedBy: ["تأییدکننده الف", "تأییدکننده ب"],
    approvedAt: "2026-11-21",
    corpusRecordIds: ["law-001-article-1"]
  }
};

const now = new Date("2026-11-21T12:00:00.000Z");

test("fails closed when the trusted public-key registry is not configured", () => {
  const previous = process.env[REGISTRY_ENV];
  delete process.env[REGISTRY_ENV];
  try {
    const result = promoteApprovedIntake(intake, { today: "2026-11-21", now, existingCorpus: [] });
    assert.equal(result.valid, false);
    assert.deepEqual(result.records, []);
    assert.match(result.errors.join("\\n"), /امضاهای دیجیتال Ed25519/);
  } finally { process.env[REGISTRY_ENV] = previous; }
});

test("rejects signatures used under the wrong role", () => {
  const candidate = signIntake(JSON.parse(JSON.stringify(intake)));
  candidate.humanAttestations.approverSignatures = candidate.humanAttestations.reviewerSignatures;
  const result = promoteApprovedIntake(candidate, { today: "2026-11-21", now, existingCorpus: [] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.records, []);
});

test("rejects a revoked public key", () => {
  const previous = process.env[REGISTRY_ENV];
  const registry = JSON.parse(previous);
  registry[0].active = false;
  process.env[REGISTRY_ENV] = JSON.stringify(registry);
  try {
    const result = runPromotion(JSON.parse(JSON.stringify(intake)), { today: "2026-11-21", now, existingCorpus: [] });
    assert.equal(result.valid, false);
    assert.deepEqual(result.records, []);
  } finally { process.env[REGISTRY_ENV] = previous; }
});

test("rejects signatures dated before the legal review or approval", () => {
  const candidate = signIntake(JSON.parse(JSON.stringify(intake)), "2026-11-19T11:59:00.000Z");
  const result = promoteApprovedIntake(candidate, { today: "2026-11-21", now, existingCorpus: [] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.records, []);
});

test("rejects tampered legal text after reviewers signed the intake", () => {
  const candidate = signIntake(JSON.parse(JSON.stringify(intake)));
  candidate.articleChecks[0].text += " متن دستکاری‌شده";
  const result = promoteApprovedIntake(candidate, { today: "2026-11-21", now, existingCorpus: [] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.records, []);
  assert.match(result.errors.join("\\n"), /امضاهای دیجیتال Ed25519/);
});

test("creates a validated article-level preview without writing the corpus", () => {
  const result = runPromotion(intake, { today: "2026-11-21", now, existingCorpus: [] });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].articleNumber, "ماده ۱");
  assert.equal(result.records[0].verificationStatus, "human_verified");
  assert.match(result.notice, /فایل corpus را تغییر نمی‌دهد/);
});

test("rejects a missing article-level record even when the intake is approved", () => {
  const candidate = JSON.parse(JSON.stringify(intake));
  candidate.articleChecks = [];
  const result = runPromotion(candidate, { today: "2026-11-21", now });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /هیچ ماده مستقلاً بررسی‌شده‌ای/);
});

test("rejects article ids that differ only by normalization", () => {
  const candidate = JSON.parse(JSON.stringify(intake));
  candidate.articleChecks.push({ ...candidate.articleChecks[0], corpusRecordId: " LAW-001-ARTICLE-1 " });
  candidate.promotion.corpusRecordIds.push(" LAW-001-ARTICLE-1 ");
  const result = runPromotion(candidate, { today: "2026-11-21", now });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /شناسه مقصد تکراری/);
});

test("rejects repealed articles and unresolved article discrepancies", () => {
  for (const mutate of [
    value => { value.articleChecks[0].status = "repealed"; },
    value => { value.articleChecks[0].unresolvedDiscrepancies = ["اختلاف متن"]; }
  ]) {
    const candidate = JSON.parse(JSON.stringify(intake));
    mutate(candidate);
    const result = runPromotion(candidate, { today: "2026-11-21", now });
    assert.equal(result.valid, false);
  }
});

test("rejects official corpus id collisions", () => {
  const existing = [{
    id: "law-001-article-1",
    title: "عنوان موجود",
    articleNumber: "ماده ۱",
    text: "متن قبلی",
    sourceType: "law",
    officialPublisher: "مرجع رسمی آزمایشی",
    officialDocumentId: "old-001",
    approvalDate: "2020-01-01",
    publicationDate: "2020-01-02",
    officialGazetteIssue: null,
    amendmentHistory: [],
    amendmentReviewStatus: "reviewed",
    amendmentReviewDate: "2026-10-01",
    sourceUrl: "https://qavanin.ir/Law/TreeText/old",
    status: "in_force",
    verificationStatus: "human_verified",
    effectiveFrom: "2020-01-03",
    effectiveTo: null,
    verifiedAt: "2026-10-01"
  }];
  const result = runPromotion(intake, { today: "2026-11-21", now, existingCorpus: existing });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /شناسه تکراری/);
});

test("requires every approved destination id to correspond to exactly one article", () => {
  const candidate = JSON.parse(JSON.stringify(intake));
  candidate.promotion.corpusRecordIds = ["law-001-article-1", "unmatched-id"];
  const result = runPromotion(candidate, { today: "2026-11-21", now });
  assert.equal(result.valid, false);
});


test("normalizes Jalali source, review, and article dates into ISO corpus dates", () => {
  const candidate = JSON.parse(JSON.stringify(intake));
  candidate.document.approvalOrIssueDate = "۱۳۹۸/۱۰/۱۱";
  candidate.document.officialPublicationDate = "۱۳۹۸/۱۰/۱۲";
  candidate.legalReview.reviewedAt = "۱۴۰۵/۰۸/۲۹";
  candidate.legalReview.amendmentsCheckedThrough = "۱۴۰۵/۰۸/۲۹";
  candidate.promotion.approvedAt = "۱۴۰۵/۰۸/۲۹";
  candidate.articleChecks[0].effectiveFrom = "۱۳۹۸/۱۰/۱۳";
  const result = runPromotion(candidate, { today: "2026-11-21", now, existingCorpus: [] });
  assert.equal(result.valid, true, result.errors.join("\\n"));
  assert.equal(result.records[0].approvalDate, "2020-01-01");
  assert.equal(result.records[0].publicationDate, "2020-01-02");
  assert.equal(result.records[0].effectiveFrom, "2020-01-03");
  assert.equal(result.records[0].verifiedAt, "2026-11-20");
});
