const test = require("node:test");
const assert = require("node:assert/strict");
const { sendWelcomeEmail, escapeHtml } = require("../lib/email");

test("welcome email safely escapes user-provided HTML", () => {
  assert.equal(escapeHtml('<script a="b">&'), '&lt;script a=&quot;b&quot;&gt;&amp;');
});

test("welcome email stays disabled when provider credentials are absent", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  try {
    const result = await sendWelcomeEmail({
      to: "lawyer@example.test",
      name: "وکیل آزمایشی",
      role: "وکیل همکار",
      loginUrl: "https://vakilyar-smart.vercel.app/lawyer-login.html"
    });
    assert.deepEqual(result, { sent: false, reason: "not_configured" });
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = oldFrom;
  }
});

test("welcome email rejects malformed recipient before network request", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "VakilYar <no-reply@example.test>";
  try {
    const result = await sendWelcomeEmail({ to: "not-an-email", name: "Test", loginUrl: "https://example.test" });
    assert.deepEqual(result, { sent: false, reason: "invalid_recipient" });
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = oldFrom;
  }
});
