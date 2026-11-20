"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCorpus } = require("../lib/legal-corpus-validation");

const now = new Date("2026-11-21T12:00:00.000Z");
const record = {
  id: "sample-law-article-1",
  title: "نمونه آزمایشی برای کنترل ساختار",
  articleNumber: "ماده آزمایشی",
  text: "این متن صرفاً داده آزمایشی برای آزمون اعتبارسنجی بانک حقوقی است.",
  sourceType: "law",
  officialPublisher: "مرجع رسمی آزمایشی",
  officialDocumentId: "test-document-001",
  approvalDate: "2020-01-01",
  publicationDate: "2020-01-02",
  officialGazetteIssue: null,
  amendmentHistory: [],
  amendmentReviewStatus: "reviewed",
  amendmentReviewDate: "2026-10-01",
  sourceUrl: "https://qavanin.ir/Law/PrintText/example",
  status: "in_force",
  verificationStatus: "human_verified",
  effectiveFrom: "2020-01-03",
  effectiveTo: null,
  verifiedAt: "2026-10-01"
};

test("accepts a structurally valid corpus record without importing it", () => {
  const result = validateCorpus([record], { now });
  assert.equal(result.valid, true);
  assert.equal(result.total, 1);
  assert.equal(result.validRecords, 1);
  assert.deepEqual(result.errors, []);
});

test("rejects a non-array corpus root", () => {
  const result = validateCorpus({ records: [record] }, { now });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /آرایه JSON/);
});

test("rejects duplicate record identifiers even if each record is otherwise valid", () => {
  const result = validateCorpus([record, { ...record, title: "عنوان دوم" }], { now });
  assert.equal(result.valid, false);
  assert.equal(result.validRecords, 2);
  assert.match(result.errors.join("\n"), /شناسه تکراری/);
});

test("reports invalid source metadata with the record index and identifier", () => {
  const result = validateCorpus([{ ...record, sourceUrl: "https://example.com/law" }], { now });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /رکورد شماره ۱/);
  assert.match(result.errors[0], /sample-law-article-1/);
});

test("keeps an empty corpus structurally valid but explicitly empty", () => {
  const result = validateCorpus([], { now });
  assert.equal(result.valid, true);
  assert.equal(result.total, 0);
  assert.equal(result.validRecords, 0);
});

test("uses the Iran-local calendar date when no reference date is supplied", () => {
  const boundary = new Date("2026-11-20T20:30:00.000Z");
  const result = validateCorpus([record], { now: boundary });
  assert.equal(result.asOfDate, "2026-11-21");
});
