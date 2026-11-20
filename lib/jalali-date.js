"use strict";

const persianDateFormatter = new Intl.DateTimeFormat("en-u-ca-persian", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC"
});

const iranDateFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Tehran"
});

function normalizeDigits(value) {
  return String(value).replace(/[۰-۹٠-٩]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 && code <= 0x06f9 ? code - 0x06f0 : code - 0x0660);
  });
}

function isValidGregorianDate(value) {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function getIranTodayIsoDate(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("A valid Date instance is required");
  }
  const parts = Object.fromEntries(
    iranDateFormatter.formatToParts(now)
      .filter(part => ["year", "month", "day"].includes(part.type))
      .map(part => [part.type, part.value])
  );
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function persianParts(date) {
  const parts = Object.fromEntries(
    persianDateFormatter.formatToParts(date)
      .filter(part => ["year", "month", "day"].includes(part.type))
      .map(part => [part.type, Number(part.value)])
  );
  return { year: parts.year, month: parts.month, day: parts.day };
}

function convertJalaliToGregorian(year, month, day) {
  if (![year, month, day].every(Number.isInteger) ||
      year < 1200 || year > 1600 ||
      month < 1 || month > 12 || day < 1 || day > 31) return null;

  // A Jalali year begins between March 19 and March 22. Search a safely
  // bounded Gregorian interval and compare calendar parts in UTC.
  const start = Date.UTC(year + 621, 2, 18);
  const end = Date.UTC(year + 622, 2, 25);
  for (let timestamp = start; timestamp <= end; timestamp += 86400000) {
    const date = new Date(timestamp);
    const parts = persianParts(date);
    if (parts.year === year && parts.month === month && parts.day === day) {
      return date.toISOString().slice(0, 10);
    }
  }
  return null;
}

function normalizeAsOfDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = normalizeDigits(value.trim());
  const match = /^(\\d{4})[\\/. -](\\d{1,2})[\\/. -](\\d{1,2})$/.exec(normalized);
  if (match) {
    const year = Number(match[1]);
    if (year >= 1200 && year <= 1600) {
      return convertJalaliToGregorian(year, Number(match[2]), Number(match[3]));
    }
  }
  return isValidGregorianDate(normalized) ? normalized : null;
}

module.exports = {
  normalizeDigits,
  isValidGregorianDate,
  getIranTodayIsoDate,
  convertJalaliToGregorian,
  normalizeAsOfDate
};
