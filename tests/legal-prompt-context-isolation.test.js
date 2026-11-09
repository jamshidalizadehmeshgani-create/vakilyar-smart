"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChatSystemMessage } = require("../lib/legal-sources/chat-prompt");

const basePrompt = "دستیار حقوقی آزمایشی";
const iranContext = "متن تأییدشده قانون اجاره ایران";

test("domestic requests may include verified Iranian legal context", () => {
  const result = buildChatSystemMessage(
    basePrompt,
    "قوانین جمهوری اسلامی ایران",
    false,
    iranContext
  );

  assert.match(result, /دستیار حقوقی آزمایشی/);
  assert.match(result, /حوزه حقوقی این درخواست: قوانین جمهوری اسلامی ایران/);
  assert.match(result, /متن تأییدشده قانون اجاره ایران/);
});

test("foreign requests never receive Iranian legal context", () => {
  const result = buildChatSystemMessage(
    basePrompt,
    "آلمان",
    true,
    iranContext
  );

  assert.match(result, /حوزه حقوقی این درخواست: آلمان/);
  assert.doesNotMatch(result, /متن تأییدشده قانون اجاره ایران/);
});

test("foreign requests remain isolated even when supplied context is whitespace padded", () => {
  const result = buildChatSystemMessage(
    basePrompt,
    "حقوق بین‌الملل",
    true,
    "  " + iranContext + "  "
  );

  assert.doesNotMatch(result, /متن تأییدشده قانون اجاره ایران/);
});

test("non-string prompt fields fail closed without throwing", () => {
  const result = buildChatSystemMessage(null, null, false, 123);

  assert.equal(result, "\nحوزه حقوقی این درخواست: ");
});

test("domestic requests ignore empty or whitespace-only verified context", () => {
  const empty = buildChatSystemMessage(basePrompt, "ایران", false, "");
  const whitespace = buildChatSystemMessage(basePrompt, "ایران", false, "   ");

  assert.doesNotMatch(empty, /\n\n/);
  assert.doesNotMatch(whitespace, /\n\n/);
});
