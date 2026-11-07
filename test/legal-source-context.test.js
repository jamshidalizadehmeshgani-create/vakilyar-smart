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
