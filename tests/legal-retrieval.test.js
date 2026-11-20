"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeText,
  validateRecord,
  retrieveLegalSources,
  buildEvidencePrompt
} = require("../lib/legal-retrieval");

const now = new Date("2026-11-21T12:00:00.000Z");
const validRecord = {
  id: "test-civil-law-article",
  title: "قانون مدنی و تعهدات قراردادی",
  articleNumber: "ماده آزمایشی",
  text: "تعهد قراردادی و مسئولیت مدنی ناشی از اجرای قرارداد باید با متن معتبر قانون بررسی شود.",
  sourceType: "law",
  officialPublisher: "سامانه ملی قوانین و مقررات",
  sourceUrl: "https://qavanin.ir/Law/PrintText/example",
  status: "in_force",
  verificationStatus: "human_verified",
  effectiveFrom: "2020-01-01",
  effectiveTo: null,
  verifiedAt: "2026-10-01"
};

test("normalization unifies Arabic and Persian letter variants", () => {
  assert.equal(normalizeText("مسئوليّت كیفری"), normalizeText("مسئولیت کیفری"));
});

test("retrieves only current human-verified records from allowlisted official domains", () => {
  const result = retrieveLegalSources("تعهد قراردادی مسئولیت مدنی", {
    corpus: [validRecord],
    now
  });
  assert.equal(result.status, "verified_sources");
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].sourceUrl, validRecord.sourceUrl);
  assert.equal(result.evidence[0].text, validRecord.text);
});

test("rejects unofficial, insecure, unverified, repealed, expired, and stale records", () => {
  const variants = [
    { ...validRecord, sourceUrl: "https://example.com/law" },
    { ...validRecord, sourceUrl: "http://qavanin.ir/law" },
    { ...validRecord, verificationStatus: "unreviewed" },
    { ...validRecord, status: "repealed" },
    { ...validRecord, effectiveTo: "2025-01-01" },
    { ...validRecord, verifiedAt: "2024-01-01" }
  ];
  for (const record of variants) assert.equal(validateRecord(record, now), false);
  assert.equal(retrieveLegalSources("تعهد قراردادی مسئولیت مدنی", {
    corpus: variants,
    now
  }).status, "no_verified_sources");
});

test("rejects impossible calendar dates and duplicate document identifiers", () => {
  assert.equal(validateRecord({ ...validRecord, effectiveFrom: "2026-02-31" }, now), false);
  const duplicate = { ...validRecord, title: "عنوان تکراری" };
  const result = retrieveLegalSources("تعهد قراردادی مسئولیت مدنی", {
    corpus: [validRecord, duplicate],
    now
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].title, validRecord.title);
});

test("retrieves only documents effective on the requested historical date", () => {
  const repealedRecord = {
    ...validRecord,
    id: "historical-law",
    effectiveFrom: "2010-01-01",
    effectiveTo: "2023-12-31"
  };
  assert.equal(validateRecord(repealedRecord, now), false);
  assert.equal(validateRecord(repealedRecord, now, "2022-06-01"), true);
  const historical = retrieveLegalSources("تعهد قراردادی مسئولیت مدنی", {
    corpus: [repealedRecord],
    now,
    asOfDate: "2022-06-01"
  });
  assert.equal(historical.status, "verified_sources");
  assert.equal(historical.sources[0].asOfDate, "2022-06-01");
  assert.equal(retrieveLegalSources("تعهد قراردادی مسئولیت مدنی", {
    corpus: [repealedRecord],
    now,
    asOfDate: "2024-01-01"
  }).status, "no_verified_sources");
});

test("rejects impossible or malformed historical reference dates", () => {
  for (const asOfDate of ["2026-02-31", "2026/02/01", "not-a-date"]) {
    assert.equal(retrieveLegalSources("تعهد قراردادی مسئولیت مدنی", {
      corpus: [validRecord],
      now,
      asOfDate
    }).status, "invalid_as_of_date");
  }
});

test("does not retrieve documents using a single coincidental word", () => {
  const result = retrieveLegalSources("تعهد بسیار", {
    corpus: [validRecord],
    now
  });
  assert.equal(result.status, "no_verified_sources");
});

test("empty corpus returns no verified evidence and an explicit caution prompt", () => {
  const result = retrieveLegalSources("پرسش حقوقی درباره قرارداد", {
    corpus: [],
    now
  });
  assert.equal(result.status, "no_verified_sources");
  assert.deepEqual(result.sources, []);
  assert.match(buildEvidencePrompt(result), /هیچ متن حقوقی رسمی/);
});

test("evidence prompt includes the retrieved text and warns against invented citations", () => {
  const result = retrieveLegalSources("تعهد قراردادی مسئولیت مدنی", {
    corpus: [validRecord],
    now
  });
  const prompt = buildEvidencePrompt(result);
  assert.match(prompt, /متن سند:/);
  assert.match(prompt, /تعهد قراردادی/);
  assert.match(prompt, /تاریخ مبنای بررسی: 2026-11-21/);
  assert.match(prompt, /هیچ ماده یا منبع دیگری نساز/);
});
