"use strict";

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const CLAIM_TYPES = new Set([
  "rule", "exception", "condition", "definition", "deadline",
  "sanction", "procedure", "right", "obligation", "other"
]);

const CHECKLIST_FIELDS = [
  "completeSentenceReviewed",
  "conditionsReviewed",
  "exceptionsReviewed",
  "crossReferencesReviewed",
  "temporalValidityReviewed",
  "amendmentAndRepealReviewed",
  "conflictsReviewed",
  "quoteContextReviewed"
];

function distinctNames(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  const normalized = value.map(name =>
    typeof name === "string" ? name.normalize("NFKC").trim().toLocaleLowerCase("fa") : ""
  );
  return normalized.every(Boolean) && new Set(normalized).size === normalized.length;
}

function detectLegalReviewRisks(value) {
  const text = String(value || "");
  const flags = [];
  const checks = [
    ["negation", /(?:نیست|نمی\w*|عدم|ممنوع|باطل|بی\s*اعتبار|جز\s*در|مگر)/u],
    ["condition_or_limitation", /(?:مشروط|در\s*صورتی\s*که|به\s*شرط|منوط|صرفاً|فقط|تنها|مگر\s*(?:اینکه|آنکه))/u],
    ["exception", /(?:استثنا|مستثنی|به\s*استثنای|جز\s*موارد|مگر)/u],
    ["cross_reference", /(?:مواد?|تبصره|بند|جزء)\s*[۰-۹٠-٩0-9]+/u],
    ["numeric_or_deadline", /[۰-۹٠-٩0-9]+|(?:روز|ماه|سال|ساعت|درصد|ریال|تومان)/u],
    ["temporal_scope", /(?:از\s*تاریخ|تا\s*تاریخ|لازم\s*الاجرا|انتشار|تصویب|ابلاغ|نسخ|اصلاح)/u]
  ];
  for (const [flag, pattern] of checks) if (pattern.test(text)) flags.push(flag);
  return flags;
}

/**
 * Structural preflight only. It does not establish legal entailment, reviewer
 * competence, source authenticity, or permission to publish an interpretation.
 */
function validateLegalClaimReviewPacket(packet, options = {}) {
  const errors = [];
  const add = message => errors.push(message);
  const sources = Array.isArray(options.sources) ? options.sources : [];
  const evidence = Array.isArray(options.evidence) ? options.evidence : [];
  const sourceIds = new Set(sources.filter(item => item && typeof item.id === "string").map(item => item.id));
  const evidenceById = new Map(evidence
    .filter(item => item && typeof item.id === "string" && typeof item.text === "string")
    .map(item => [item.id, item.text]));

  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { valid: false, decision: "rejected", publishable: false, errors: ["بسته بازبینی باید یک شیء JSON باشد."], claims: [] };
  }
  if (packet.schemaVersion !== 1) add("نسخه schemaVersion باید ۱ باشد.");
  if (!isIsoDate(packet.asOfDate)) add("تاریخ مبنای تحلیل باید به قالب YYYY-MM-DD معتبر باشد.");
  if (!Array.isArray(packet.claims) || packet.claims.length === 0 || packet.claims.length > 100) {
    add("بسته باید بین ۱ تا ۱۰۰ ادعای مستقل داشته باشد.");
  }

  const seenClaimIds = new Set();
  const claims = [];
  for (const [index, claim] of (Array.isArray(packet.claims) ? packet.claims : []).entries()) {
    const prefix = "ادعای " + (index + 1) + ": ";
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      add(prefix + "ساختار نامعتبر است.");
      continue;
    }
    if (typeof claim.id !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(claim.id) || seenClaimIds.has(claim.id)) {
      add(prefix + "شناسه باید معتبر و یکتا باشد.");
    } else seenClaimIds.add(claim.id);
    if (typeof claim.text !== "string" || !claim.text.trim() || claim.text.length > 2000) add(prefix + "متن ادعا خالی یا بیش از حد طولانی است.");
    if (!CLAIM_TYPES.has(claim.claimType)) add(prefix + "نوع ادعا پشتیبانی نمی‌شود.");
    if (typeof claim.sourceId !== "string" || !sourceIds.has(claim.sourceId)) add(prefix + "شناسه منبع در فهرست منابع تأییدشده وجود ندارد.");
    if (typeof claim.quote !== "string" || claim.quote.length < 20 || claim.quote.length > 1200) {
      add(prefix + "گزیده مستند باید بین ۲۰ تا ۱۲۰۰ نویسه باشد.");
    } else {
      const sourceText = evidenceById.get(claim.sourceId);
      if (typeof sourceText !== "string" || !sourceText.includes(claim.quote)) {
        add(prefix + "گزیده باید عیناً و پیوسته در متن همان منبع بازیابی‌شده وجود داشته باشد.");
      }
    }
    for (const field of ["conditions", "exceptions", "crossReferences"]) {
      if (!Array.isArray(claim[field]) || claim[field].some(item => typeof item !== "string" || !item.trim())) {
        add(prefix + field + " باید آرایه‌ای از موارد صریح و غیرخالی باشد.");
      }
    }
    if (claim.articleNumber !== undefined && (typeof claim.articleNumber !== "string" || !claim.articleNumber.trim())) {
      add(prefix + "شماره ماده در صورت درج باید رشته‌ای غیرخالی باشد.");
    }
    const riskFlags = detectLegalReviewRisks((claim.text || "") + " " + (claim.quote || ""));
    const checklist = claim.reviewChecklist;
    if (!checklist || typeof checklist !== "object" || CHECKLIST_FIELDS.some(field => checklist[field] !== true)) {
      add(prefix + "تمام کنترل‌های جمله، قیود، استثناها، ارجاعات، اعتبار زمانی، اصلاحات/نسخ، تعارض و بافت نقل‌قول باید جداگانه تأیید شوند.");
    }
    claims.push({ id: claim.id || null, riskFlags });
  }

  const review = packet.independentReview;
  if (!review || typeof review !== "object" ||
      !distinctNames(review.reviewers) || !distinctNames(review.approvers)) {
    add("حداقل دو بازبین مستقل و دو تأییدکننده مستقل لازم است.");
  } else {
    const reviewers = new Set(review.reviewers.map(name => name.normalize("NFKC").trim().toLocaleLowerCase("fa")));
    if (review.approvers.some(name => reviewers.has(name.normalize("NFKC").trim().toLocaleLowerCase("fa")))) {
      add("بازبینان و تأییدکنندگان باید اشخاص جداگانه باشند.");
    }
  }
  if (!isIsoDate(review?.reviewedAt) || !isIsoDate(review?.approvedAt) ||
      (isIsoDate(review?.reviewedAt) && isIsoDate(review?.approvedAt) && review.approvedAt < review.reviewedAt)) {
    add("تاریخ بازبینی و تأیید باید معتبر و به ترتیب زمانی باشد.");
  }
  if (review?.outcome !== "approved_for_human_review") {
    add("نتیجه باید صریحاً approved_for_human_review باشد؛ این وضعیت مجوز انتشار نیست.");
  }

  return {
    valid: errors.length === 0,
    decision: errors.length ? "rejected" : "human_review_packet_structurally_complete",
    publishable: false,
    errors,
    claims,
    limitations: [
      "این کنترل فقط ساختار بسته، اتصال نقل‌قول به منبع و تکمیل چک‌لیست را می‌سنجد.",
      "این کنترل دلالت معنایی ادعا بر نقل‌قول، صلاحیت حرفه‌ای اشخاص یا اصالت حقوقی سند را اثبات نمی‌کند.",
      "حتی بسته معتبر نیز بدون راستی‌آزمایی مستقل هویت و صلاحیت بازبینان و تأیید نهایی انسانی، مجوز انتشار تفسیر حقوقی نیست."
    ]
  };
}

module.exports = { CLAIM_TYPES, CHECKLIST_FIELDS, detectLegalReviewRisks, validateLegalClaimReviewPacket };
