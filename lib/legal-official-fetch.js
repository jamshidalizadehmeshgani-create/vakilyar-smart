"use strict";

const { createHash } = require("node:crypto");
const { isOfficialUrl } = require("./legal-intake-validation");

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("حجم سند از سقف مجاز بیشتر است.");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error("جریان دریافت سند در دسترس نیست.");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("حجم سند از سقف مجاز بیشتر است.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchOfficialLegalDocument(sourceUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? 5;
  if (typeof fetchImpl !== "function") throw new Error("پیاده‌سازی fetch در دسترس نیست.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("سقف حجم نامعتبر است.");
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) throw new Error("حد تغییرمسیر نامعتبر است.");

  let currentUrl = sourceUrl;
  const redirectChain = [];
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isOfficialUrl(currentUrl)) throw new Error("نشانی منبع یا مقصد تغییرمسیر رسمی و امن نیست.");
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/pdf, text/plain;q=0.9" }
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      if (hop === maxRedirects) throw new Error("تعداد تغییرمسیرها از حد مجاز بیشتر است.");
      const location = response.headers.get("location");
      if (!location) throw new Error("پاسخ تغییرمسیر فاقد Location است.");
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isOfficialUrl(nextUrl)) throw new Error("تغییرمسیر به میزبان غیررسمی یا ناامن رد شد.");
      redirectChain.push(nextUrl);
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) throw new Error("دریافت سند ناموفق بود؛ وضعیت HTTP: " + response.status);

    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["application/pdf", "text/plain"].includes(contentType)) {
      throw new Error("نوع محتوای پاسخ سند حقوقی پشتیبانی نمی‌شود: " + (contentType || "نامشخص"));
    }
    const bytes = await readBoundedBody(response, maxBytes);
    if (contentType === "application/pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("محتوای پاسخ PDF معتبر نیست؛ امضای فایل وجود ندارد.");
    }
    if (contentType === "text/plain" && bytes.length === 0) {
      throw new Error("سند متنی خالی است.");
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      bytes,
      metadata: {
        requestedUrl: sourceUrl,
        finalUrl: currentUrl,
        redirectChain,
        mimeType: contentType,
        byteLength: bytes.length,
        sha256,
        retrievedAtUtc: new Date().toISOString()
      }
    };
  }
  throw new Error("دریافت سند به پایان نرسید.");
}

module.exports = { fetchOfficialLegalDocument, DEFAULT_MAX_BYTES };
