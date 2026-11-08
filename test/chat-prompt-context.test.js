"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChatSystemMessage } = require("../lib/legal-sources/chat-prompt");

const basePrompt = "دستیار حقوقی";
const leaseContext = "منبع محدود اجاره: ماده 486";

test("includes curated lease context in an Iranian request", () => {
  const prompt = buildChatSystemMessage(basePrompt, "قوانین جمهوری اسلامی ایران", false, leaseContext);
  assert.match(prompt, /دستیار حقوقی/);
  assert.match(prompt, /قوانین جمهوری اسلامی ایران/);
  assert.match(prompt, /منبع محدود اجاره: ماده 486/);
});

test("never attaches Iranian lease context to a foreign-law request", () => {
  const prompt = buildChatSystemMessage(basePrompt, "قوانین آلمان", true, leaseContext);
  assert.match(prompt, /قوانین آلمان/);
  assert.doesNotMatch(prompt, /منبع محدود اجاره/);
});

test("omits empty or non-text context without breaking prompt composition", () => {
  for (const context of ["", "   ", null, undefined, 42]) {
    const prompt = buildChatSystemMessage(basePrompt, "قوانین جمهوری اسلامی ایران", false, context);
    assert.equal(prompt, "دستیار حقوقی\nحوزه حقوقی این درخواست: قوانین جمهوری اسلامی ایران");
  }
});
