"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateIntake } = require("../lib/legal-intake-validation");

const valid = {
  schemaVersion: 1,
  recordStatus: "approved_for_corpus",
  document: {
    title: "سند آزمایشی",
    sourceType: "law",
    officialPublisher: "مرجع رسمی آزمایشی",
    officialDocumentId: "doc-001",
    approvalOrIssueDate: "2020-01-01",
    officialPublicationDate: "2020-01-02",
    officialSourcePageUrl: "https://qavanin.ir/Law/TreeText/1",
    officialDownloadUrl: "https://qavanin.ir/Pdfs/1.pdf",
    retrievedAtUtc: "2026-11-20T10:00:00Z",
    retrievedBy: "اپراتور الف",
    originalFilename: "law.pdf",
    mimeType: "application/pdf",
    byteLength: 1024,
    pageCount: 10,
    sha256: "a".repeat(64),
    licenseOrReuseBasis: "مجوز رسمی آزمایشی",
    licenseEvidenceUrl: "https://qavanin.ir/license",
    redirectChain: "https://qavanin.ir/Pdfs/1.pdf"
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
    implicitRepealIssuesFlagged: [],
    unresolvedDiscrepancies: [],
    reviewOutcome: "approved"
  },
  promotion: {
    approvedForCorpus: true,
    approvedBy: ["تأییدکننده الف", "تأییدکننده ب"],
    approvedAt: "2026-11-20",
    corpusRecordIds: ["sample-law-article-1"]
  }
};

test("accepts a fully documented and independently reviewed intake", () => {
  assert.deepEqual(validateIntake(valid, { today: "2026-11-21" }), { valid: true, errors: [] });
});

test("rejects unapproved or quarantined intake", () => {
  const result = validateIntake({ ...valid, recordStatus: "quarantined_pending_verification" }, { today: "2026-11-21" });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\\n"), /approved_for_corpus/);
});

test("rejects unofficial, insecure, credential-bearing, or malformed URLs", () => {
  for (const url of ["http://qavanin.ir/law", "https://example.com/law", "https://user:pass@qavanin.ir/law"]) {
    const intake = structuredClone(valid);
    intake.document.officialSourcePageUrl = url;
    assert.equal(validateIntake(intake, { today: "2026-11-21" }).valid, false);
  }
});

test("requires file integrity evidence and a second SHA-256 check", () => {
  const intake = structuredClone(valid);
  intake.integrityChecks.sha256RecomputedBySecondReviewer = false;
  assert.equal(validateIntake(intake, { today: "2026-11-21" }).valid, false);
});

test("requires two distinct legal reviewers and two distinct approvers", () => {
  const intake = structuredClone(valid);
  intake.legalReview.reviewedBy = ["بازبین الف", "بازبین الف"];
  intake.promotion.approvedBy = ["تأییدکننده الف", "تأییدکننده الف"];
  const result = validateIntake(intake, { today: "2026-11-21" });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\\n"), /بازبین حقوقی مستقل/);
  assert.match(result.errors.join("\\n"), /تأییدکننده مستقل/);
});

test("rejects future, impossible, and reversed dates", () => {
  for (const date of ["2026-02-31", "2026-11-22", "not-a-date"]) {
    const intake = structuredClone(valid);
    intake.document.officialPublicationDate = date;
    assert.equal(validateIntake(intake, { today: "2026-11-21" }).valid, false);
  }
  const reversed = structuredClone(valid);
  reversed.document.approvalOrIssueDate = "2021-01-01";
  reversed.document.officialPublicationDate = "2020-01-01";
  assert.equal(validateIntake(reversed, { today: "2026-11-21" }).valid, false);
});

test("rejects path traversal, unsupported MIME, missing license evidence, and malformed hashes", () => {
  const intake = structuredClone(valid);
  intake.document.originalFilename = "../law.pdf";
  intake.document.mimeType = "application/octet-stream";
  intake.document.licenseEvidenceUrl = "https://example.com/license";
  intake.document.sha256 = "not-a-hash";
  assert.equal(validateIntake(intake, { today: "2026-11-21" }).valid, false);
});

test("does not accept unresolved legal discrepancies or incomplete article scope", () => {
  const intake = structuredClone(valid);
  intake.legalReview.unresolvedDiscrepancies = ["اختلاف متن"];
  intake.legalReview.articleRangeReviewed = "";
  assert.equal(validateIntake(intake, { today: "2026-11-21" }).valid, false);
});
