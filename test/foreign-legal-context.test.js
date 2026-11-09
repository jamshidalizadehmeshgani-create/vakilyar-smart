"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChatSystemMessage } = require("../lib/legal-sources/chat-prompt");

const IRAN_LEASE_CONTEXT = "منبع حقوقی محدود: ماده ۴۸۶ قانون مدنی.";

test("domestic requests may receive the curated Iranian legal context", () => {
  const message = buildChatSystemMessage(
    "دستور پایه",
    "قوانین جمهوری اسلامی ایران",
    false,
    IRAN_LEASE_CONTEXT
  );

  assert.match(message, /حوزه حقوقی این درخواست: قوانین جمهوری اسلامی ایران/);
  assert.ok(message.includes(IRAN_LEASE_CONTEXT));
});

test("foreign requests never receive curated Iranian legal context", () => {
  const message = buildChatSystemMessage(
    "دستور پایه",
    "قوانین آلمان",
    true,
    IRAN_LEASE_CONTEXT
  );

  assert.match(message, /حوزه حقوقی این درخواست: قوانین آلمان/);
  assert.ok(!message.includes(IRAN_LEASE_CONTEXT));
  assert.ok(!message.includes("ماده ۴۸۶"));
});

test("empty or non-string legal context is not appended", () => {
  for (const context of ["", "   ", null, undefined, 123, {}]) {
    const message = buildChatSystemMessage(
      "دستور پایه",
      "قوانین جمهوری اسلامی ایران",
      false,
      context
    );
    assert.equal(message.includes("منبع حقوقی محدود"), false);
  }
});

test("missing scope and system prompt values remain safe", () => {
  const message = buildChatSystemMessage(undefined, undefined, false, IRAN_LEASE_CONTEXT);
  assert.match(message, /حوزه حقوقی این درخواست: $/);
  assert.ok(message.includes(IRAN_LEASE_CONTEXT));
});

test("foreign requests without a supplied context remain foreign-scoped", () => {
  const message = buildChatSystemMessage(
    "دستور پایه",
    "حقوق بین‌الملل",
    true,
    ""
  );

  assert.match(message, /حوزه حقوقی این درخواست: حقوق بین‌الملل/);
  assert.ok(!message.includes("منبع حقوقی محدود"));
});
