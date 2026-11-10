const test = require("node:test");
const assert = require("node:assert/strict");
const { sendWelcomeEmail, escapeHtml, getAppBaseUrl } = require("../lib/email");

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

test("lawyer verification email requires a valid token and provider configuration", async () => {
  const old = {
    key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL,
    base: process.env.APP_BASE_URL
  };
  const { sendLawyerVerificationEmail } = require("../lib/email");
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    assert.deepEqual(await sendLawyerVerificationEmail({
      to: "lawyer@example.test", name: "وکیل آزمایشی", token: "a".repeat(64)
    }), { sent: false, reason: "not_configured" });
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "VakilYar <no-reply@example.test>";
    assert.deepEqual(await sendLawyerVerificationEmail({
      to: "lawyer@example.test", name: "وکیل آزمایشی", token: "invalid"
    }), { sent: false, reason: "invalid_token" });
  } finally {
    if (old.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = old.key;
    if (old.from === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = old.from;
    if (old.base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = old.base;
  }
});

test("lawyer verification email sends a one-time URL without exposing it in the result", async () => {
  const originalFetch = global.fetch;
  const old = {
    key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL,
    base: process.env.APP_BASE_URL
  };
  const token = "b".repeat(64);
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "VakilYar <no-reply@example.test>";
  process.env.APP_BASE_URL = "https://app.example.test";
  let payload;
  global.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    payload = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };
  try {
    const result = await require("../lib/email").sendLawyerVerificationEmail({
      to: "LAWYER@example.test", name: "<وکیل>", token
    });
    assert.deepEqual(result, { sent: true });
    assert.equal(payload.to[0], "lawyer@example.test");
    assert.match(payload.html, new RegExp("/api/lawyer/verify-email\\?token=" + token));
    assert.match(payload.html, /&lt;وکیل&gt;/);
    assert.equal(JSON.stringify(result).includes(token), false);
  } finally {
    global.fetch = originalFetch;
    if (old.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = old.key;
    if (old.from === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = old.from;
    if (old.base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = old.base;
  }
});

test("preview email links use the current Vercel deployment when APP_BASE_URL is unset", () => {
  const oldBase = process.env.APP_BASE_URL;
  const oldVercelUrl = process.env.VERCEL_URL;
  try {
    delete process.env.APP_BASE_URL;
    process.env.VERCEL_URL = "vakilyar-preview.example.vercel.app";
    assert.equal(getAppBaseUrl(), "https://vakilyar-preview.example.vercel.app");
    process.env.APP_BASE_URL = "https://custom.example.test/";
    assert.equal(getAppBaseUrl(), "https://custom.example.test");
  } finally {
    if (oldBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = oldBase;
    if (oldVercelUrl === undefined) delete process.env.VERCEL_URL; else process.env.VERCEL_URL = oldVercelUrl;
  }
});


test("user password reset email stays disabled without provider configuration", async () => {
  const old = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL };
  const originalFetch = global.fetch;
  let calls = 0;
  delete process.env.RESEND_API_KEY; delete process.env.RESEND_FROM_EMAIL;
  global.fetch = async () => { calls++; throw new Error("network must not be called"); };
  try {
    const result = await require("../lib/email").sendUserPasswordResetEmail({
      to: "user@example.test", name: "کاربر", token: "a".repeat(64)
    });
    assert.deepEqual(result, { sent: false, reason: "not_configured" });
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
    if (old.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = old.key;
    if (old.from === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = old.from;
  }
});

test("user password reset email rejects invalid tokens and insecure application URLs", async () => {
  const old = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL, base: process.env.APP_BASE_URL };
  const originalFetch = global.fetch;
  let calls = 0;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "VakilYar <no-reply@example.test>";
  global.fetch = async () => { calls++; throw new Error("network must not be called"); };
  try {
    const send = require("../lib/email").sendUserPasswordResetEmail;
    assert.deepEqual(await send({ to: "user@example.test", name: "کاربر", token: "invalid" }), { sent: false, reason: "invalid_input" });
    process.env.APP_BASE_URL = "http://app.example.test";
    assert.deepEqual(await send({ to: "user@example.test", name: "کاربر", token: "a".repeat(64) }), { sent: false, reason: "invalid_app_url" });
    assert.deepEqual(await send({ to: "bad-email", name: "کاربر", token: "a".repeat(64) }), { sent: false, reason: "invalid_input" });
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
    if (old.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = old.key;
    if (old.from === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = old.from;
    if (old.base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = old.base;
  }
});

test("user password reset email uses the deployment origin, escapes the name and never returns the token", async () => {
  const old = {
    key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL,
    base: process.env.APP_BASE_URL, vercel: process.env.VERCEL_URL
  };
  const originalFetch = global.fetch;
  const token = "c".repeat(64);
  let payload, requestUrl;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "VakilYar <no-reply@example.test>";
  delete process.env.APP_BASE_URL;
  process.env.VERCEL_URL = "preview.example.vercel.app";
  global.fetch = async (url, options) => {
    requestUrl = String(url);
    payload = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };
  try {
    const result = await require("../lib/email").sendUserPasswordResetEmail({
      to: "USER@example.test", name: "<کاربر>", token
    });
    assert.deepEqual(result, { sent: true });
    assert.equal(requestUrl, "https://api.resend.com/emails");
    assert.deepEqual(payload.to, ["user@example.test"]);
    assert.equal(payload.subject, "پیوند امن بازیابی گذرواژه وکیل‌یار");
    assert.ok(payload.html.includes("https://preview.example.vercel.app/user-reset-password.html?token=" + token));
    assert.match(payload.html, /&lt;کاربر&gt;/);
    assert.equal(JSON.stringify(result).includes(token), false);
    assert.equal(JSON.stringify(result).includes("USER@example.test"), false);
  } finally {
    global.fetch = originalFetch;
    if (old.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = old.key;
    if (old.from === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = old.from;
    if (old.base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = old.base;
    if (old.vercel === undefined) delete process.env.VERCEL_URL; else process.env.VERCEL_URL = old.vercel;
  }
});

test("user password reset email hides provider failures from callers", async () => {
  const old = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL, base: process.env.APP_BASE_URL };
  const originalFetch = global.fetch;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "VakilYar <no-reply@example.test>";
  process.env.APP_BASE_URL = "https://app.example.test";
  global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ message: "private provider detail" }) });
  try {
    assert.deepEqual(await require("../lib/email").sendUserPasswordResetEmail({
      to: "user@example.test", name: "کاربر", token: "d".repeat(64)
    }), { sent: false, reason: "provider_error" });
  } finally {
    global.fetch = originalFetch;
    if (old.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = old.key;
    if (old.from === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = old.from;
    if (old.base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = old.base;
  }
});
