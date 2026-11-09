const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeLegalReply } = require("../lib/legal-output");

test("replaces unsupported Persian article number ranges", () => {
  const result = sanitizeLegalReply("طبق ماده‌های ۱۶۱–۱۶۵ و ماده ۲۳۱ عمل کنید.");
  assert.doesNotMatch(result, /۱۶۱|۱۶۵|۲۳۱/);
  assert.match(result, /شماره ماده در این پاسخ تأیید نشده است/);
});

test("replaces unsupported numbered statute references", () => {
  const result = sanitizeLegalReply("قانون اجاره‌نامه‌های مسکونی (قانون ۳۱/۱۳۷۹) را ببینید.");
  assert.doesNotMatch(result, /۳۱\/۱۳۷۹/);
  assert.match(result, /عنوان و شماره قانون در این پاسخ تأیید نشده است/);
});

test("replaces the generated legal-basis section and preserves practical sections", () => {
  const result = sanitizeLegalReply(
    "## مبنای حقوقی و حدود اطمینان\n- ماده ۲۳۱ قانون نمونه\n## اقدام‌های پیشنهادی\n۱. سند را بررسی کنید."
  );
  assert.doesNotMatch(result, /ماده ۲۳۱|قانون نمونه/);
  assert.match(result, /منبع رسمی/);
  assert.match(result, /اقدام‌های پیشنهادی/);
  assert.match(result, /سند را بررسی کنید/);
});

test("keeps a useful answer with no legal citations unchanged", () => {
  const input = "پیش از امضا، هویت طرف مقابل و مفاد قرارداد را بررسی کنید.";
  assert.equal(sanitizeLegalReply(input), input);
});

test("handles non-string provider output safely", () => {
  assert.equal(sanitizeLegalReply(null), "");
});

test("preserves following sections even when their heading is not in the known list", () => {
  const result = sanitizeLegalReply(
    "## مبنای حقوقی\n- ماده ۲۳۱ قانون نمونه\n## نکات تکمیلی\nاین توضیح عمومی باید باقی بماند."
  );
  assert.doesNotMatch(result, /ماده ۲۳۱|قانون نمونه/);
  assert.match(result, /نکات تکمیلی/);
  assert.match(result, /این توضیح عمومی باید باقی بماند/);
});

test("replaces common named statute titles even without article numbers", () => {
  const input = "طبق قانون مدنی و قانون مجازات اسلامی، همچنین قانون آیین دادرسی کیفری اقدام کنید.";
  const result = sanitizeLegalReply(input);
  assert.doesNotMatch(result, /قانون مدنی|قانون مجازات اسلامی|قانون آیین دادرسی کیفری/);
  assert.equal((result.match(/عنوان قانون در این پاسخ تأیید نشده است/g) || []).length, 3);
});

test("replaces named statute titles with ZWNJ and Persian spacing variants", () => {
  const input = "قانون حمایت خانواده و قانون روابط موجر و مستأجر باید بررسی شوند.";
  const result = sanitizeLegalReply(input);
  assert.doesNotMatch(result, /قانون حمایت خانواده|قانون روابط موجر و مستأجر/);
  assert.equal((result.match(/عنوان قانون در این پاسخ تأیید نشده است/g) || []).length, 2);
});

test("does not rewrite generic use of the word law", () => {
  const input = "قانون در این زمینه باید از منبع رسمی بررسی شود.";
  assert.equal(sanitizeLegalReply(input), input);
});
