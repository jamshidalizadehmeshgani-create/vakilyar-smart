const ARTICLE_REFERENCE = /ماده(?:‌های|های|‌ی|ی)?\s*(?:شماره\s*)?[۰-۹0-9]+(?:\s*(?:تا|الی|[-–—،,])\s*[۰-۹0-9]+)*/giu;
const NUMBERED_LAW_REFERENCE = /(?:قانون|قوانین)\s+[^،؛\n]{1,100}?\s*\(\s*(?:قانون\s*)?[۰-۹0-9]{1,4}\s*[/-]\s*[۰-۹0-9]{2,4}\s*\)/giu;
const NAMED_LAW_REFERENCE = /قانون\s+(?:آیین\s+دادرسی\s+(?:مدنی|کیفری)|مجازات\s+اسلامی|حمایت\s+خانواده|مسئولیت\s+مدنی|ثبت\s+اسناد\s+و\s+املاک|روابط\s+موجر\s+و\s+مستأجر|جرایم\s+رایانه[‌یی]*|صدور\s+چک|مدنی|تجارت|کار|اساسی)/giu;

function sanitizeLegalReply(value) {
  if (typeof value !== "string") return "";
  let reply = value;

  // Without a connected, authoritative legal-source retrieval system, do not
  // present article numbers or statute names as verified law.
  reply = reply.replace(ARTICLE_REFERENCE, "شماره ماده در این پاسخ تأیید نشده است");
  reply = reply.replace(NUMBERED_LAW_REFERENCE, "عنوان و شماره قانون در این پاسخ تأیید نشده است");
  reply = reply.replace(NAMED_LAW_REFERENCE, "عنوان قانون در این پاسخ تأیید نشده است");

  // Replace a model-generated legal-basis section with a transparent limitation.
  // This avoids preserving unsupported statute names or fabricated citations.
  const sectionPattern = /(^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?مبنای حقوقی(?:\s+و\s+حدود\s+اطمینان)?(?:\*\*)?[^\n]*\n[\s\S]*?(?=\n\s*(?:#{1,6}\s+|\*\*[^*\n]+\*\*)|$)/iu;
  if (sectionPattern.test(reply)) {
    reply = reply.replace(
      sectionPattern,
      "$1**مبنای حقوقی و حدود اطمینان**\nبرای جلوگیری از استناد نادرست، در این نسخه شماره مواد و عنوان قوانین بدون اتصال و بررسی منبع رسمی ارائه نمی‌شود. متن قانون و اصلاحات جاری باید از منبع رسمی بررسی شود.\n"
    );
  }

  return reply.replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = { sanitizeLegalReply };
