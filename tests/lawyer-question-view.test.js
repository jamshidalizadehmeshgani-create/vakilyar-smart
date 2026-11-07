const test = require("node:test");
const assert = require("node:assert/strict");
const { toLawyerQuestionView } = require("../lib/lawyer-question-view");

test("lawyer inbox view exposes only fields required by the lawyer panel", () => {
  const view = toLawyerQuestionView({
    id: "a".repeat(32),
    lawyer_id: "b".repeat(32),
    user_id: "private-account-id",
    question: "متن پرسش",
    status: "answered",
    created_at: "2026-11-07T10:00:00.000Z",
    updated_at: "2026-11-07T11:00:00.000Z",
    internal_note: "must not be exposed",
    replies: [{
      id: "reply-internal-id",
      lawyer_id: "b".repeat(32),
      lawyer_name: "نام وکیل",
      message: "پاسخ",
      created_at: "2026-11-07T11:00:00.000Z",
      private_metadata: "must not be exposed"
    }]
  });

  assert.deepEqual(view, {
    id: "a".repeat(32),
    question: "متن پرسش",
    status: "answered",
    created_at: "2026-11-07T10:00:00.000Z",
    updated_at: "2026-11-07T11:00:00.000Z",
    replies: [{ message: "پاسخ", created_at: "2026-11-07T11:00:00.000Z" }]
  });
  assert.equal("user_id" in view, false);
  assert.equal("internal_note" in view, false);
});

test("rejects malformed question records and normalizes optional fields", () => {
  assert.equal(toLawyerQuestionView(null), null);
  assert.equal(toLawyerQuestionView({ id: "x", question: "متن" }), null);
  assert.deepEqual(toLawyerQuestionView({
    id: "a".repeat(32), lawyer_id: "b".repeat(32), question: "متن"
  }), {
    id: "a".repeat(32), question: "متن", status: "open",
    created_at: null, updated_at: null, replies: []
  });
});
