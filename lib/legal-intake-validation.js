"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeAsOfDate } = require("./jalali-date");

const OFFICIAL_HOSTS = new Set([
  "qavanin.ir", "www.qavanin.ir", "dotic.ir", "www.dotic.ir",
  "rrk.ir", "www.rrk.ir"
]);

function isLegalDate(value) {
  return normalizeAsOfDate(value) !== null;
}

function isValidUtcTimestamp(value) {
  const match = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value)
    : null;
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day) &&
    parsed.getUTCHours() === Number(hour) &&
    parsed.getUTCMinutes() === Number(minute) &&
    parsed.getUTCSeconds() === Number(second) &&
    parsed.getUTCMilliseconds() === Number(fraction.padEnd(3, "0") || "0");
}

function isOfficialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      OFFICIAL_HOSTS.has(url.hostname.toLowerCase()) &&
      (!url.port || url.port === "443") &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function distinctPeople(list) {
  if (!Array.isArray(list) || list.length < 2) return false;
  const names = list.map(value => typeof value === "string" ? value.normalize("NFKC").trim().toLocaleLowerCase("fa") : "");
  return names.every(Boolean) && new Set(names).size === names.length;
}

function validateIntake(intake, options = {}) {
  const today = normalizeAsOfDate(options.today || new Date().toISOString().slice(0, 10));
  const errors = [];
  const add = message => errors.push(message);
  if (!today) return { valid: false, errors: ["تاریخ مبنای اعتبارسنجی معتبر نیست."] };
  if (!intake || typeof intake !== "object" || Array.isArray(intake)) {
    return { valid: false, errors: ["پرونده دریافت باید یک شیء JSON باشد."] };
  }
  if (intake.schemaVersion !== 1) add("نسخه قالب پرونده پشتیبانی نمی‌شود.");
  if (intake.recordStatus !== "approved_for_corpus") add("پرونده هنوز وضعیت approved_for_corpus ندارد.");

  const doc = intake.document;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    add("بخش document وجود ندارد یا ساختار آن معتبر نیست.");
  } else {
    for (const key of ["title", "sourceType", "officialPublisher", "officialDocumentId", "originalFilename", "mimeType", "licenseOrReuseBasis"]) {
      if (typeof doc[key] !== "string" || !doc[key].trim()) add("فراداده سند ناقص است: " + key);
    }
    if (!["law", "regulation", "unified_precedent", "advisory_opinion"].includes(doc.sourceType)) add("نوع سند مجاز نیست.");
    if (!isOfficialUrl(doc.officialSourcePageUrl)) add("صفحه منبع باید HTTPS و روی دامنه رسمی مجاز باشد.");
    if (!isOfficialUrl(doc.officialDownloadUrl)) add("پیوند دریافت باید HTTPS و روی دامنه رسمی مجاز باشد.");
    if (!isOfficialUrl(doc.licenseEvidenceUrl)) add("شاهد مجوز استفاده باید از دامنه رسمی مجاز باشد.");
    if (!/^([a-f0-9]{64})$/i.test(doc.sha256 || "")) add("هش SHA-256 باید دقیقاً ۶۴ رقم هگزادسیمال باشد.");
    if (!Number.isSafeInteger(doc.byteLength) || doc.byteLength <= 0) add("حجم فایل باید عدد صحیح مثبت باشد.");
    if (!Number.isSafeInteger(doc.pageCount) || doc.pageCount <= 0) add("تعداد صفحات باید عدد صحیح مثبت باشد.");
    if (!/^[^/\\]+$/.test(doc.originalFilename || "")) add("نام فایل نباید مسیر یا جداکننده مسیر داشته باشد.");
    if (typeof doc.mimeType === "string" && !["application/pdf", "text/plain"].includes(doc.mimeType)) add("نوع MIME فایل پشتیبانی نمی‌شود.");
    if (!isValidUtcTimestamp(doc.retrievedAtUtc) || doc.retrievedAtUtc.slice(0, 10) > today) add("زمان دریافت UTC نامعتبر یا در آینده است.");
    if (typeof doc.approvalOrIssueDate !== "string" || !isLegalDate(doc.approvalOrIssueDate) || normalizeAsOfDate(doc.approvalOrIssueDate) > today) add("تاریخ تصویب/صدور معتبر نیست.");
    if (typeof doc.officialPublicationDate !== "string" || !isLegalDate(doc.officialPublicationDate) || normalizeAsOfDate(doc.officialPublicationDate) > today) add("تاریخ انتشار رسمی معتبر نیست.");
    if (isLegalDate(doc.approvalOrIssueDate) && isLegalDate(doc.officialPublicationDate) && normalizeAsOfDate(doc.approvalOrIssueDate) > normalizeAsOfDate(doc.officialPublicationDate)) add("تاریخ تصویب/صدور نمی‌تواند پس از تاریخ انتشار باشد.");
    if (typeof doc.retrievedBy !== "string" || !doc.retrievedBy.trim()) add("ثبت دریافت‌کننده سند الزامی است.");
    if (!Array.isArray(doc.redirectChain) ||
        doc.redirectChain.some(url => !isOfficialUrl(url))) add("فهرست تغییرمسیرها باید آرایه‌ای از نشانی‌های رسمی HTTPS باشد؛ آرایه خالی یعنی تغییرمسیری رخ نداده است.");
  }

  const integrity = intake.integrityChecks;
  const integrityKeys = [
    "downloadedFromOfficialHost", "redirectChainRecorded", "fileOpensWithoutRepair",
    "pageCountRecorded", "documentIdentityMatchesOfficialMetadata",
    "sha256RecomputedBySecondReviewer", "completeDocumentConfirmed"
  ];
  if (!integrity || typeof integrity !== "object" ||
      integrityKeys.some(key => integrity[key] !== true)) {
    add("همه کنترل‌های اصالت و تمامیت فایل باید صریحاً true باشند.");
  }

  const review = intake.legalReview;
  if (!review || typeof review !== "object") {
    add("بخش بازبینی حقوقی وجود ندارد.");
  } else {
    if (!distinctPeople(review.reviewedBy)) add("حداقل دو بازبین حقوقی مستقل با نام‌های متمایز لازم است.");
    if (!isLegalDate(review.reviewedAt) || normalizeAsOfDate(review.reviewedAt) > today) add("تاریخ بازبینی حقوقی معتبر نیست.");
    if (typeof review.articleRangeReviewed !== "string" || !review.articleRangeReviewed.trim()) add("دامنه مواد بررسی‌شده باید مشخص باشد.");
    for (const key of ["articleNumberingChecked", "textComparedWithOfficialPublication", "explicitRepealsChecked", "effectiveDatesChecked", "transitionalRulesChecked"]) {
      if (review[key] !== true) add("کنترل حقوقی تکمیل نشده است: " + key);
    }
    if (!isLegalDate(review.amendmentsCheckedThrough) || normalizeAsOfDate(review.amendmentsCheckedThrough) > today) add("تاریخ پوشش بررسی اصلاحات معتبر نیست.");
    if (!Array.isArray(review.unresolvedDiscrepancies) || review.unresolvedDiscrepancies.length !== 0) add("وجود اختلاف حل‌نشده مانع ورود به بانک است.");
    if (review.reviewOutcome !== "approved") add("نتیجه بازبینی حقوقی باید approved باشد.");
  }

  const promotion = intake.promotion;
  if (!promotion || typeof promotion !== "object") {
    add("بخش تأیید ورود به بانک وجود ندارد.");
  } else {
    if (promotion.approvedForCorpus !== true) add("تأیید صریح ورود به بانک ثبت نشده است.");
    if (!distinctPeople(promotion.approvedBy)) add("دو تأییدکننده مستقل و متمایز لازم است.");
    if (review && Array.isArray(review.reviewedBy) && Array.isArray(promotion.approvedBy)) {
      const reviewers = new Set(review.reviewedBy.map(name => String(name).normalize("NFKC").trim().toLocaleLowerCase("fa")));
      if (promotion.approvedBy.some(name => reviewers.has(String(name).normalize("NFKC").trim().toLocaleLowerCase("fa")))) {
        add("تأییدکنندگان ورود به بانک باید از بازبینان حقوقی مستقل باشند.");
      }
    }
    if (review && isLegalDate(review.reviewedAt) && isLegalDate(promotion.approvedAt) && normalizeAsOfDate(promotion.approvedAt) < normalizeAsOfDate(review.reviewedAt)) {
      add("تأیید ورود به بانک نمی‌تواند پیش از پایان بازبینی حقوقی باشد.");
    }
    if (!isLegalDate(promotion.approvedAt) || normalizeAsOfDate(promotion.approvedAt) > today) add("تاریخ تأیید ورود معتبر نیست.");
    if (!Array.isArray(promotion.corpusRecordIds) || promotion.corpusRecordIds.length === 0 ||
        promotion.corpusRecordIds.some(id => typeof id !== "string" || !id.trim()) ||
        new Set(promotion.corpusRecordIds).size !== promotion.corpusRecordIds.length) {
      add("شناسه‌های رکورد مقصد باید غیرخالی، یکتا و مشخص باشند.");
    }
  }

  return { valid: errors.length === 0, errors };
}

if (require.main === module) {
  const inputPath = path.resolve(process.cwd(), process.argv[2] || "legal/intake.json");
  let intake;
  try {
    intake = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch (error) {
    console.error("خواندن پرونده دریافت ناموفق بود: " + error.message);
    process.exitCode = 1;
  }
  if (intake !== undefined) {
    const result = validateIntake(intake);
    if (!result.valid) {
      console.error("پرونده برای ورود به بانک حقوقی تأیید نشد:");
      for (const error of result.errors) console.error("- " + error);
      process.exitCode = 1;
    } else {
      console.log("کنترل ساختاری پرونده دریافت موفق بود. انتقال به corpus همچنان نیازمند بازبینی و ثبت جداگانه است.");
    }
  }
}

module.exports = { validateIntake, isOfficialUrl, isLegalDate, isValidUtcTimestamp };
