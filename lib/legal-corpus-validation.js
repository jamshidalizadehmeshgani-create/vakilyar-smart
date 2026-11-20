"use strict";

const { validateRecord } = require("./legal-retrieval");
const { getIranTodayIsoDate } = require("./jalali-date");

function validateCorpus(corpus, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const asOfDate = options.asOfDate || getIranTodayIsoDate(now);
  const errors = [];

  if (!Array.isArray(corpus)) {
    return { valid: false, total: 0, validRecords: 0, errors: ["ریشه بانک باید یک آرایه JSON باشد."] };
  }
  if (!Number.isFinite(now.getTime())) {
    return { valid: false, total: corpus.length, validRecords: 0, errors: ["زمان مبنای اعتبارسنجی معتبر نیست."] };
  }

  const seen = new Set();
  let validRecords = 0;
  corpus.forEach((record, index) => {
    const label = "رکورد شماره " + new Intl.NumberFormat("fa-IR").format(index + 1);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(label + ": ساختار رکورد باید یک شیء JSON باشد.");
      return;
    }
    if (typeof record.id === "string" && record.id.trim()) {
      if (seen.has(record.id)) errors.push(label + ": شناسه تکراری است: " + record.id);
      seen.add(record.id);
    }
    if (!validateRecord(record, now, asOfDate)) {
      errors.push(label + " (" + (record.id || "بدون شناسه") + "): الزامات منبع رسمی، تاریخ اعتبار، بازبینی انسانی یا تازگی تأیید را ندارد.");
      return;
    }
    validRecords += 1;
  });

  return {
    valid: errors.length === 0,
    total: corpus.length,
    validRecords,
    asOfDate,
    errors
  };
}

module.exports = { validateCorpus };
