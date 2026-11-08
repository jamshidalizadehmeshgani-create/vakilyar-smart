"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getIranLeaseLawContext } = require("../lib/legal-sources/iran-civil-code-lease");

test("adds curated Iranian Civil Code context to lease questions", () => {
  const context = getIranLeaseLawContext("تعهدات موجر و مستأجر در قرارداد اجاره چیست؟");
  assert.match(context, /ماده 476 قانون مدنی/);
  assert.match(context, /ماده 486 قانون مدنی/);
  assert.match(context, /شرط خلاف شده یا عرف بلد/);
  assert.match(context, /ماده 490 قانون مدنی/);
});

test("does not add lease context to unrelated questions", () => {
  assert.equal(getIranLeaseLawContext("شرایط تحقق مسئولیت مدنی چیست؟"), "");
});

test("does not treat unsupported lease topics as settled law", () => {
  const context = getIranLeaseLawContext("آیا موجر می‌تواند بدون اجازه وارد ملک شود؟");
  assert.match(context, /ورود موجر به ملک/);
  assert.match(context, /ادعای قطعی نساز/);
});

test("includes only the intended Civil Code lease article set", () => {
  const context = getIranLeaseLawContext("قرارداد اجاره و تعهدات طرفین");
  for (const article of [466, 476, 477, 478, 484, 485, 486, 490]) {
    assert.match(context, new RegExp(`ماده ${article} قانون مدنی`));
  }
  assert.doesNotMatch(context, /ماده 173 قانون مدنی|ماده 174 قانون مدنی/);
});

test("warns that contract type, date, and special statutes may change the analysis", () => {
  const context = getIranLeaseLawContext("شرایط تخلیه ملک اجاره‌ای چیست؟");
  assert.match(context, /نوع اجاره/);
  assert.match(context, /تاریخ قرارداد/);
  assert.match(context, /قوانین خاص اجاره/);
});

test("marks common unsupported lease topics as requiring further review", () => {
  const questions = [
    "آیا موجر بدون اجازه می‌تواند وارد ملک شود؟",
    "ودیعه یا پول پیش چه زمانی باید برگردانده شود؟",
    "شرایط قانونی تخلیه ملک اجاره‌ای چیست؟",
    "آیا قرارداد اجاره خودبه‌خود تمدید می‌شود؟"
  ];
  for (const question of questions) {
    const context = getIranLeaseLawContext(question);
    assert.notEqual(context, "", `expected lease context for: ${question}`);
    assert.match(context, /ورود موجر به ملک/);
    assert.match(context, /ودیعه/);
    assert.match(context, /تخلیه/);
    assert.match(context, /تمدید/);
    assert.match(context, /ادعای قطعی نساز/);
  }
});

test("handles missing and non-text input without throwing or adding a source", () => {
  for (const value of [undefined, null, 42, {}, [], ""]) {
    assert.equal(getIranLeaseLawContext(value), "");
  }
});

