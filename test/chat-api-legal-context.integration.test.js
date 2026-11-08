"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function createHarness(options = {}) {
  const apiSource = fs.readFileSync(path.join(__dirname, "../api/chat.js"), "utf8");
  const calls = { providerBody: null, providerCalls: 0 };
  const quota = {
    getAccount: async () => ({ key: "test-account", isPro: Boolean(options.isPro), isUnlimited: false }),
    classifyRequest: () => 100,
    reserveCredits: async () => 900,
    refundReservation: async () => true,
    commitReservation: async () => 1,
    consumeIpRateLimit: async () => ({ count: 0, limit: 20, windowSeconds: 900 })
  };
  const legalSources = {
    getIranLeaseLawContext: () => "CURATED_IRAN_LEASE_CONTEXT"
  };
  const chatPrompt = require("../lib/legal-sources/chat-prompt");
  const mockedRequire = (id) => {
    if (id === "crypto") return crypto;
    if (id === "../lib/quota") return quota;
    if (id === "../lib/legal-sources/iran-civil-code-lease") return legalSources;
    if (id === "../lib/legal-sources/chat-prompt") return chatPrompt;
    throw new Error("Unexpected dependency in API test: " + id);
  };
  const sandbox = {
    module: { exports: {} },
    require: mockedRequire,
    process: { env: { AI_API_KEY: "test-only-key", AI_API_URL: "https://mock-ai.invalid/chat" } },
    URL,
    AbortSignal,
    fetch: async (_url, init) => {
      calls.providerCalls += 1;
      calls.providerBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "پاسخ آزمایشی" } }] })
      };
    },
    console: { error: () => {} }
  };
  vm.runInNewContext("(function(require, module) { " + apiSource + "\n})", sandbox)(mockedRequire, sandbox.module);
  const handler = sandbox.module.exports;
  const req = {
    method: "POST",
    headers: { host: "example.test", origin: "https://example.test", "sec-fetch-site": "same-origin" },
    body: {
      consent: true,
      message: options.message || "مسئولیت تعمیرات ضروری در قرارداد اجاره چیست؟",
      ...(options.legal_scope ? { legal_scope: options.legal_scope } : {}),
      ...(options.country ? { country: options.country } : {})
    }
  };
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  return { handler, req, res, calls };
}

test("API sends curated Iranian lease context to the AI provider for an Iranian request", async () => {
  const h = createHarness();
  await h.handler(h.req, h.res);
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.calls.providerCalls, 1);
  assert.match(h.calls.providerBody.messages[0].content, /CURATED_IRAN_LEASE_CONTEXT/);
});

test("API excludes Iranian lease context for a Pro request about foreign law", async () => {
  const h = createHarness({ isPro: true, legal_scope: "foreign", country: "Germany", message: "What does German lease law say?" });
  await h.handler(h.req, h.res);
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.calls.providerCalls, 1);
  assert.doesNotMatch(h.calls.providerBody.messages[0].content, /CURATED_IRAN_LEASE_CONTEXT/);
  assert.match(h.calls.providerBody.messages[0].content, /Germany/);
});

test("API blocks foreign-law requests from non-Pro accounts before calling the provider", async () => {
  const h = createHarness({ isPro: false, legal_scope: "foreign", country: "Germany", message: "What does German lease law say?" });
  await h.handler(h.req, h.res);
  assert.equal(h.res.statusCode, 403);
  assert.equal(h.res.body.code, "PRO_REQUIRED");
  assert.equal(h.calls.providerCalls, 0);
});
