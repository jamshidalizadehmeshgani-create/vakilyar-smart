"use strict";

const { validateIntake, isOfficialUrl, isLegalDate } = require("./legal-intake-validation");
const { normalizeAsOfDate } = require("./jalali-date");
const { validateRecord } = require("./legal-retrieval");
const { validateCorpus } = require("./legal-corpus-validation");

function promoteApprovedIntake(intake, options = {}) {
  const today = normalizeAsOfDate(options.today || new Date().toISOString().slice(0, 10));
  if (!today) return { valid: false, records: [], errors: ["تاریخ مبنای پیش‌نمایش معتبر نیست."] };
  const intakeCheck = validateIntake(intake, { today });
  if (!intakeCheck.valid) {
    return { valid: false, records: [], errors: intakeCheck.errors.map(error => "پرونده دریافت: " + error) };
  }

  const errors = [];
  const document = intake.document;
  const review = intake.legalReview;
  const promotion = intake.promotion;
  const articles = intake.articleChecks;
  if (!Array.isArray(articles) || articles.length === 0) {
    return { valid: false, records: [], errors: ["هیچ ماده مستقلاً بررسی‌شده‌ای برای انتقال ثبت نشده است."] };
  }

  const amendments = intake.amendmentDocuments;
  if (!Array.isArray(amendments)) {
    return { valid: false, records: [], errors: ["فهرست اسناد اصلاحی باید آرایه باشد."] };
  }
  const amendmentHistory = amendments.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push("سند اصلاحی شماره " + (index + 1) + " ساختار معتبر ندارد.");
      return null;
    }
    const mapped = {
      documentId: item.officialDocumentId,
      title: item.title,
      changeType: item.changeType,
      approvalDate: normalizeAsOfDate(item.approvalDate),
      publicationDate: normalizeAsOfDate(item.publicationDate),
      effectiveFrom: normalizeAsOfDate(item.effectiveFrom),
      effectiveTo: item.effectiveTo == null ? null : normalizeAsOfDate(item.effectiveTo),
      sourceUrl: item.officialSourcePageUrl
    };
    if (typeof mapped.documentId !== "string" || !mapped.documentId.trim() ||
        typeof mapped.title !== "string" || !mapped.title.trim() ||
        !["amended", "repealed", "added", "interpreted", "other"].includes(mapped.changeType) ||
        !isLegalDate(mapped.approvalDate) || !isLegalDate(mapped.publicationDate) ||
        !isLegalDate(mapped.effectiveFrom) ||
        (mapped.effectiveTo !== null && !isLegalDate(mapped.effectiveTo)) ||
        !isOfficialUrl(mapped.sourceUrl)) {
      errors.push("فراداده سند اصلاحی شماره " + (index + 1) + " ناقص یا غیررسمی است.");
      return null;
    }
    return mapped;
  });
  if (errors.length) return { valid: false, records: [], errors };

  const records = [];
  const ids = new Set();
  for (let index = 0; index < articles.length; index += 1) {
    const article = articles[index];
    const label = "ماده شماره " + (index + 1);
    if (!article || typeof article !== "object" || Array.isArray(article)) {
      errors.push(label + " ساختار معتبر ندارد.");
      continue;
    }
    const required = ["corpusRecordId", "articleNumber", "text", "effectiveFrom"];
    for (const key of required) {
      if (typeof article[key] !== "string" || !article[key].trim()) {
        errors.push(label + ": فیلد " + key + " الزامی است.");
      }
    }
    if (typeof article.corpusRecordId === "string") {
      const normalized = article.corpusRecordId.normalize("NFKC").trim().toLocaleLowerCase("fa");
      if (ids.has(normalized)) errors.push(label + ": شناسه مقصد تکراری است.");
      ids.add(normalized);
    }
    if (article.status !== "in_force") errors.push(label + ": فقط مواد جاری و تأییدشده قابل انتقال‌اند.");
    if (!isLegalDate(article.effectiveFrom) || normalizeAsOfDate(article.effectiveFrom) > today) errors.push(label + ": تاریخ شروع اثر نامعتبر است.");
    if (article.effectiveTo != null && (!isLegalDate(article.effectiveTo) || normalizeAsOfDate(article.effectiveTo) < normalizeAsOfDate(article.effectiveFrom))) {
      errors.push(label + ": تاریخ پایان اثر نامعتبر است.");
    }
    if (article.unresolvedDiscrepancies !== undefined &&
        (!Array.isArray(article.unresolvedDiscrepancies) || article.unresolvedDiscrepancies.length !== 0)) {
      errors.push(label + ": اختلاف حل‌نشده دارد.");
    }
    if (article.text && article.text.length > 30000) errors.push(label + ": متن ماده از سقف مجاز بیشتر است.");
    if (errors.length) continue;

    const record = {
      id: article.corpusRecordId,
      title: document.title,
      articleNumber: article.articleNumber,
      text: article.text,
      sourceType: document.sourceType,
      officialPublisher: document.officialPublisher,
      officialDocumentId: document.officialDocumentId,
      approvalDate: normalizeAsOfDate(document.approvalOrIssueDate),
      publicationDate: normalizeAsOfDate(document.officialPublicationDate),
      officialGazetteIssue: document.officialGazetteIssue || null,
      amendmentHistory,
      amendmentReviewStatus: "reviewed",
      amendmentReviewDate: normalizeAsOfDate(review.amendmentsCheckedThrough),
      sourceUrl: document.officialSourcePageUrl,
      status: article.status,
      verificationStatus: "human_verified",
      effectiveFrom: normalizeAsOfDate(article.effectiveFrom),
      effectiveTo: article.effectiveTo == null ? null : normalizeAsOfDate(article.effectiveTo),
      verifiedAt: normalizeAsOfDate(review.reviewedAt)
    };
    if (!validateRecord(record, options.now instanceof Date ? options.now : new Date(), today)) {
      errors.push(label + ": رکورد حاصل با اعتبارسنج نهایی بانک حقوقی سازگار نیست.");
      continue;
    }
    records.push(record);
  }

  if (errors.length || records.length !== articles.length ||
      records.length !== promotion.corpusRecordIds.length ||
      records.some(record => !promotion.corpusRecordIds.includes(record.id))) {
    return { valid: false, records: [], errors: errors.length ? errors : ["شناسه‌های مواد با فهرست تأییدشده مقصد مطابقت ندارند."] };
  }

  const existing = Array.isArray(options.existingCorpus) ? options.existingCorpus : [];
  const corpusCheck = validateCorpus([...existing, ...records], {
    now: options.now instanceof Date ? options.now : new Date(),
    asOfDate: today
  });
  if (!corpusCheck.valid) {
    return { valid: false, records: [], errors: corpusCheck.errors.map(error => "اعتبارسنجی بانک مقصد: " + error) };
  }

  return {
    valid: true,
    records,
    errors: [],
    notice: "پیش‌نمایش انتقال معتبر است؛ این تابع فایل corpus را تغییر نمی‌دهد. ثبت نهایی باید جداگانه و با بازبینی انسانی انجام شود."
  };
}

module.exports = { promoteApprovedIntake };
