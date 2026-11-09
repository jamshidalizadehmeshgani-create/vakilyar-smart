"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isForeignLegalRequest,
  mentionsForeignCountry,
  isIranScope
} = require("../lib/legal-sources/jurisdiction");

test("Iran scope aliases remain domestic", () => {
  for (const value of ["iran", "IRAN", "ایران", "ir"]) {
    assert.equal(isIranScope(value), true);
    assert.equal(isForeignLegalRequest("شرایط قرارداد چیست؟", value, ""), false);
  }
});

test("explicit foreign scope or country is classified as foreign", () => {
  assert.equal(isForeignLegalRequest("قرارداد اجاره", "foreign", ""), true);
  assert.equal(isForeignLegalRequest("قرارداد اجاره", "iran", "آلمان"), true);
  assert.equal(isForeignLegalRequest("قرارداد اجاره", "", "Germany"), true);
});

test("foreign law phrases and country mentions are detected", () => {
  assert.equal(isForeignLegalRequest("قوانین آلمان درباره اجاره", "", ""), true);
  assert.equal(isForeignLegalRequest("حقوق بین‌الملل خصوصی چیست؟", "", ""), true);
  assert.equal(mentionsForeignCountry("I live in Germany."), true);
  assert.equal(mentionsForeignCountry("قانون کشور ژاپن"), true);
});

test("country names are matched as whole words, not substrings", () => {
  assert.equal(mentionsForeignCountry("The word germanic is not a country."), false);
  assert.equal(mentionsForeignCountry("germanic terminology only"), false);
  assert.equal(mentionsForeignCountry("فرانسه"), true);
  assert.equal(mentionsForeignCountry("فرانسوی"), false);
});

test("ordinary Iranian legal questions without foreign indicators remain domestic", () => {
  for (const question of [
    "شرایط مطالبه مهریه چیست؟",
    "تعهدات موجر در قرارداد اجاره چیست؟",
    "مسئولیت مدنی در ایران چگونه بررسی می‌شود؟"
  ]) {
    assert.equal(isForeignLegalRequest(question, "iran", "ایران"), false);
  }
});

test("missing and non-text inputs do not throw or create foreign routing", () => {
  for (const value of [undefined, null, 42, {}, []]) {
    assert.equal(isForeignLegalRequest(value, undefined, undefined), false);
    assert.equal(mentionsForeignCountry(value), false);
  }
});
