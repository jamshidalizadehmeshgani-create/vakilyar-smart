"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const dateUtils = require("../lib/jalali-date");

function loadChatHandler() {
  const source = fs.readFileSync(path.join(__dirname, "../handlers/chat.js"), "utf8");
  const calls = [];
  const module = { exports: null };
  const sandbox = {
    module,
    exports: module.exports,
    process: { env: { AI_API_KEY: "test-key" } },
    console: { error() {} },
    URL,
    AbortSignal,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "پاسخ آزمایشی" } }] })
    }),
    require(id) {
      if (id === "crypto") return require("node:crypto");
      if (id === "../lib/legal-retrieval") return {
        retrieveLegalSources(message, options) {
          calls.push({ message, options });
          return { status: "no_verified_sources", sources: [], evidence: [] };
        },
        buildEvidencePrompt() { return "no verified evidence"; }
      };
      if (id === "../lib/jalali-date") return {
        normalizeAsOfDate: dateUtils.normalizeAsOfDate,
        getIranTodayIsoDate: () => "2026-11-21"
      };
      if (id === "../lib/quota") return {
        getAccount: async () => ({ key: "test-account", isPro: false, isUnlimited: true }),
        classifyRequest: () => 1,
        reserveCredits: async () => 1,
        refundReservation: async () => true,
        commitReservation: async () => 1,
        consumeIpRateLimit: async () => ({ count: 1, limit: 30, windowSeconds: 900 })
      };
      throw new Error("Unexpected dependency: " + id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "handlers/chat.js" });
  return { handler: module.exports, calls };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function request(body) {
  return {
    method: "POST",
    headers: {
      host: "preview.example.test",
      origin: "https://preview.example.test",
      "sec-fetch-site": "same-origin"
    },
    body: { consent: true, message: "پرسش درباره تعهد قراردادی", ...body }
  };
}

test("chat normalizes a supplied Jalali date before legal retrieval", async () => {
  const { handler, calls } = loadChatHandler();
  const res = response();
  await handler(request({ as_of_date: "۱۴۰۵/۰۸/۳۰" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.asOfDate, "2026-11-21");
  assert.equal(res.body.legal_as_of_date, "2026-11-21");
});

test("chat defaults legal retrieval to the current Iran-local date", async () => {
  const { handler, calls } = loadChatHandler();
  const res = response();
  await handler(request({}), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.asOfDate, "2026-11-21");
  assert.equal(res.body.legal_as_of_date, "2026-11-21");
});

test("chat rejects invalid reference dates before quota or AI work", async () => {
  const { handler, calls } = loadChatHandler();
  const res = response();
  await handler(request({ as_of_date: "۱۴۰۵/۱۲/۳۰" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "INVALID_AS_OF_DATE");
  assert.equal(calls.length, 0);
});
