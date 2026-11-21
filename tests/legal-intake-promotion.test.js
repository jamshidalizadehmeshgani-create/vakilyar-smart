"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { promoteApprovedIntake } = require("../lib/legal-intake-promotion");

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
    approvedAt: "2026-11-20",
    corpusRecordIds: ["law-001-article-1"]
  }
};

const now = new Date("2026-11-21T12:00:00.000Z");

test("fails closed when no trusted human-attestation verifier is configured", () => {
  const result = promoteApprovedIntake(intake, { today: "2026-11-21", now, existingCorpus: [] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.records, []);
  assert.match(result.errors.join("\\n"), /احراز هویت و امضای دیجیتال/);
});

test("rejects a failed human-attestation verification", () => {
  const result = promoteApprovedIntake(intake, {
    today: "2026-11-21", now, existingCorpus: [],
    verifyHumanAttestation: () => false
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.records, []);
  assert.match(result.errors.join("\\n"), /تأیید مستقل/);
});

test("creates a validated article-level preview without writing the corpus", () => {
  const result = promoteApprovedIntake(intake, { today: "2026-11-21", now, existingCorpus: [], verifyHumanAttestation: () => true });
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].articleNumber, "ماده ۱");
  assert.equal(result.records[0].verificationStatus, "human_verified");
  assert.match(result.notice, /فایل corpus را تغییر نمی‌دهد/);
});

test("rejects a missing article-level record even when the intake is approved", () => {
  const candidate = JSON.parse(JSON.stringify(intake));
  candidate.articleChecks = [];
  const result = promoteApprovedIntake(candidate, { today: "2026-11-21", now, verifyHumanAttestation: () => true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /هیچ ماده مستقلاً بررسی‌شده‌ای/);
});

test("rejects article ids that differ only by normalization", () => {
  const candidate = JSON.parse(JSON.stringify(intake));
  candidate.articleChecks.push({ ...candidate.articleChecks[0], corpusRecordId: " LAW-001-ARTICLE-1 " });
  candidate.promotion.corpusRecordIds.push(" LAW-001-ARTICLE-1 ");
  const result = promoteApprovedIntake(candidate, { today: "2026-11-21", now, verifyHumanAttestation: () => true });
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
    const result = promoteApprovedIntake(candidate, { today: "2026-11-21", now, verifyHumanAttestation: () => true });
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
  const result = promoteApprovedIntake(intake, { today: "2026-11-21", now, existingCorpus: existing, verifyHumanAttestation: () => true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /شناسه تکراری/);
});

test("requires every approved destination id to correspond to exactly one article", () => {
  const candidate = JSON.parse(JSON.stringify(intake));
  candidate.promotion.corpusRecordIds = ["law-001-article-1", "unmatched-id"];
  const result = promoteApprovedIntake(candidate, { today: "2026-11-21", now, verifyHumanAttestation: () => true });
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
  const result = promoteApprovedIntake(candidate, { today: "2026-11-21", now, existingCorpus: [], verifyHumanAttestation: () => true });
  assert.equal(result.valid, true, result.errors.join("\\n"));
  assert.equal(result.records[0].approvalDate, "2020-01-01");
  assert.equal(result.records[0].publicationDate, "2020-01-02");
  assert.equal(result.records[0].effectiveFrom, "2020-01-03");
  assert.equal(result.records[0].verifiedAt, "2026-11-20");
});
