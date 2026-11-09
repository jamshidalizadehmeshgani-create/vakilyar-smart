"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getIranLeaseLawContext,
  IRAN_LEASE_ARTICLES
} = require("../lib/legal-sources/iran-civil-code-lease");

test("curated Iranian lease context is supplied only for lease-related questions", () => {
  assert.ok(getIranLeaseLawContext("مسئولیت موجر در تعمیرات چیست؟").includes("ماده 486"));
  assert.ok(getIranLeaseLawContext("حقوق مستأجر چیست؟").includes("ماده 466"));
  for (const question of ["سلام", "شرایط طلاق چیست؟", "جرم سرقت چیست؟", "", null, 42]) {
    assert.equal(getIranLeaseLawContext(question), "");
  }
});

test("curated lease context contains only the explicitly enumerated articles", () => {
  const context = getIranLeaseLawContext("در قرارداد اجاره تعمیرات با چه کسی است؟");
  const articleSection = context.split("قواعد استفاده از منبع:")[0];
  const listedNumbers = IRAN_LEASE_ARTICLES.map((item) => item.number);
  assert.deepEqual(listedNumbers, [466, 476, 477, 478, 484, 485, 486, 490]);
  for (const number of listedNumbers) assert.ok(articleSection.includes("ماده " + number));
  // The guidance section intentionally names 173/174 to prohibit hallucinated citations.
  assert.ok(!articleSection.includes("ماده 173"));
  assert.ok(!articleSection.includes("ماده 174"));
  assert.match(context, /ماده 173 یا 174 را به عنوان مبنای اجاره ذکر نکن/);
});

test("lease context preserves the material qualifications and scope warnings", () => {
  const context = getIranLeaseLawContext("ودیعه و اجاره");
  assert.match(context, /مگر آنکه شرط خلاف شده یا عرف بلد بر خلاف آن جاری باشد/);
  assert.match(context, /جامع یا جایگزین متن رسمی به.?روز نیست/);
  assert.match(context, /درباره ورود موجر به ملک/);
  assert.match(context, /قرارداد و قانون خاص مرتبط/);
});

test("lease article entries expose a number, subject, and non-empty source text", () => {
  for (const article of IRAN_LEASE_ARTICLES) {
    assert.ok(Number.isInteger(article.number));
    assert.ok(article.subject.trim().length > 0);
    assert.ok(article.text.trim().length > 0);
  }
});
