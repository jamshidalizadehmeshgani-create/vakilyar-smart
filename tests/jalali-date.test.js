"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDigits,
  convertJalaliToGregorian,
  normalizeAsOfDate,
  getIranTodayIsoDate
} = require("../lib/jalali-date");

test("normalizes Persian and Arabic numerals", () => {
  assert.equal(normalizeDigits("۱۴۰۵/۰۸/۳۰"), "1405/08/30");
  assert.equal(normalizeDigits("١٤٠٥/٠٨/٣٠"), "1405/08/30");
});

test("converts a known Jalali date to its exact Gregorian day", () => {
  assert.equal(convertJalaliToGregorian(1405, 8, 30), "2026-11-21");
  assert.equal(normalizeAsOfDate("۱۴۰۵/۰۸/۳۰"), "2026-11-21");
  assert.equal(normalizeAsOfDate("1405-08-30"), "2026-11-21");
});

test("handles leap Jalali year end and rejects invalid leap days", () => {
  assert.equal(convertJalaliToGregorian(1399, 12, 30), "2021-03-20");
  assert.equal(convertJalaliToGregorian(1400, 12, 30), null);
  assert.equal(convertJalaliToGregorian(1405, 7, 31), null);
});

test("preserves valid Gregorian ISO dates and rejects malformed inputs", () => {
  assert.equal(normalizeAsOfDate("2026-11-21"), "2026-11-21");
  for (const value of ["2026-02-31", "1405/13/01", "1405/08/31", "1405/00/10", "not-a-date", ""]) {
    assert.equal(normalizeAsOfDate(value), null, value);
  }
});

test("formats the current date in Iran rather than UTC near midnight", () => {
  assert.equal(getIranTodayIsoDate(new Date("2026-11-20T20:29:59.000Z")), "2026-11-20");
  assert.equal(getIranTodayIsoDate(new Date("2026-11-20T20:30:00.000Z")), "2026-11-21");
  assert.equal(getIranTodayIsoDate(new Date("2026-06-01T20:30:00.000Z")), "2026-06-02");
});

test("rejects invalid Date values for Iran-local date formatting", () => {
  assert.throws(() => getIranTodayIsoDate(new Date("invalid")), /valid Date/);
});
