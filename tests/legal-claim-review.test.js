"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectLegalReviewRisks,
  validateLegalClaimReviewPacket,
  CHECKLIST_FIELDS
} = require("../lib/legal-claim-review");

const source = { id: "law-1" };
const evidence = [{
  id: "law-1",
  text: "هرگاه متعهد از انجام تعهد خودداری کند، مسئول جبران خسارت خواهد بود مگر آنکه علت خارجی اثبات شود."
}];
const claimText = "متعهد در صورت خودداری از انجام تعهد، مسئول جبران خسارت است مگر آنکه علت خارجی اثبات شود.";
const quote = evidence[0].text;
const checklist = Object.fromEntries(CHECKLIST_FIELDS.map(field => [field, true]));
const validPacket = {
  schemaVersion: 1,
  asOfDate: "2026-11-21",
  claims: [{
    id: "claim-1",
    text: claimText,
    claimType: "obligation",
    sourceId: "law-1",
    articleNumber: "ماده فرضی",
    quote,
    conditions: ["خودداری از انجام تعهد"],
    exceptions: ["اثبات علت خارجی"],
    crossReferences: [],
    reviewChecklist: checklist
  }],
  independentReview: {
    reviewers: ["بازبین الف", "بازبین ب"],
    approvers: ["تأییدکننده ج", "تأییدکننده د"],
    reviewedAt: "2026-11-20",
    approvedAt: "2026-11-21",
    outcome: "approved_for_human_review"
  }
};

test("detects legal conditions, exceptions, numeric deadlines, cross-references and temporal scope", () => {
  const flags = detectLegalReviewRisks("مگر آنکه ظرف ۲۰ روز مطابق ماده ۱۲۳ از تاریخ ابلاغ اقدام شود.");
  for (const flag of ["condition_or_limitation", "exception", "numeric_or_deadline", "cross_reference", "temporal_scope"]) {
    assert.ok(flags.includes(flag), flag);
  }
});

test("accepts a structurally complete claim packet but never authorizes publication", () => {
  const result = validateLegalClaimReviewPacket(validPacket, { sources: [source], evidence });
  assert.equal(result.valid, true);
  assert.equal(result.decision, "human_review_packet_structurally_complete");
  assert.equal(result.publishable, false);
  assert.ok(result.claims[0].riskFlags.includes("exception"));
  assert.equal(result.limitations.length, 3);
});

test("rejects fabricated or cross-source quotes", () => {
  const packet = structuredClone(validPacket);
  packet.claims[0].quote = "این متن در هیچ سندی وجود ندارد و نقل قول ساختگی است.";
  const result = validateLegalClaimReviewPacket(packet, { sources: [source], evidence });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("عیناً و پیوسته")));
});

test("rejects a source identifier not present in the verified source list", () => {
  const packet = structuredClone(validPacket);
  packet.claims[0].sourceId = "invented-source";
  const result = validateLegalClaimReviewPacket(packet, { sources: [source], evidence });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("منبع در فهرست")));
});

test("requires explicit review of every legal dimension and rejects reviewer overlap", () => {
  const packet = structuredClone(validPacket);
  packet.claims[0].reviewChecklist.exceptionsReviewed = false;
  packet.independentReview.approvers = ["بازبین الف", "تأییدکننده د"];
  const result = validateLegalClaimReviewPacket(packet, { sources: [source], evidence });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("تمام کنترل‌های جمله")));
  assert.ok(result.errors.some(error => error.includes("اشخاص جداگانه")));
});

test("rejects duplicate claim IDs, invalid dates, missing arrays and incomplete packet", () => {
  const packet = structuredClone(validPacket);
  packet.asOfDate = "2026-02-31";
  packet.claims.push({ ...packet.claims[0] });
  packet.claims[0].conditions = "not-an-array";
  const result = validateLegalClaimReviewPacket(packet, { sources: [source], evidence });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 4);
});

test("rejects invalid or empty packets and missing evidence", () => {
  assert.equal(validateLegalClaimReviewPacket(null).publishable, false);
  const result = validateLegalClaimReviewPacket(validPacket, { sources: [source], evidence: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("همان منبع")));
});
