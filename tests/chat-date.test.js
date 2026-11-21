"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const dateUtils = require("../lib/jalali-date");

function loadChatHandler({ retrievalStatus = "no_verified_sources", evidence = true, throwRetrieval = false, reply = "گزیده مستقیم از متن سند (بدون تفسیر حقوقی): [[source:verified-test-source]] [[quote:verified-test-source]] «متن رسمی آزمایشی درباره تعهدات قراردادی و مسئولیت مدنی»" } = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../handlers/chat.js"), "utf8");
  const calls = [];
  const state = { aiCalls: 0, refundCalls: 0, reserveCalls: 0, commitCalls: 0 };
  const module = { exports: null };
  const sandbox = {
    module,
    exports: module.exports,
    process: { env: { AI_API_KEY: "test-key" } },
    console: { error() {} },
    URL,
    AbortSignal,
    fetch: async (_endpoint, options) => {
      state.aiCalls += 1;
      state.messages = JSON.parse(options.body).messages;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: reply } }] })
      };
    },
    require(id) {
      if (id === "crypto") return require("node:crypto");
      if (id === "../lib/legal-retrieval") return {
        retrieveLegalSources(message, options) {
          calls.push({ message, options });
          if (throwRetrieval) throw new Error("mock retrieval failure");
          const verified = retrievalStatus === "verified_sources";
          return {
            status: retrievalStatus,
            sources: verified ? [{ id: "verified-test-source", sourceUrl: "https://qavanin.ir/test" }] : [],
            evidence: verified && evidence ? [{ id: "verified-test-source", text: "متن رسمی آزمایشی درباره تعهدات قراردادی و مسئولیت مدنی" }] : []
          };
        },
        buildEvidencePrompt() { return "verified evidence"; },
        validateAnswerEvidence: require("../lib/legal-retrieval").validateAnswerEvidence
      };
      if (id === "../lib/jalali-date") return {
        normalizeAsOfDate: dateUtils.normalizeAsOfDate,
        getIranTodayIsoDate: () => "2026-11-21"
      };
      if (id === "../lib/quota") return {
        getAccount: async () => ({ key: "test-account", isPro: false, isUnlimited: false }),
        classifyRequest: () => 10,
        reserveCredits: async () => { state.reserveCalls += 1; return 90; },
        refundReservation: async () => { state.refundCalls += 1; return 90; },
        commitReservation: async () => { state.commitCalls += 1; return 1; },
        consumeIpRateLimit: async () => ({ count: 1, limit: 30, windowSeconds: 900 })
      };
      throw new Error("Unexpected dependency: " + id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "handlers/chat.js" });
  return { handler: module.exports, calls, state };
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

test("chat normalizes a supplied Jalali date and blocks generation when no verified source exists", async () => {
  const { handler, calls, state } = loadChatHandler();
  const res = response();
  await handler(request({ as_of_date: "۱۴۰۵/۰۸/۳۰" }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "LEGAL_EVIDENCE_UNAVAILABLE");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.asOfDate, "2026-11-21");
  assert.equal(res.body.legal_as_of_date, "2026-11-21");
  assert.equal(state.aiCalls, 0, "model must not be called without verified legal evidence");
  assert.equal(state.reserveCalls, 1);
  assert.equal(state.refundCalls, 1, "reserved credits must be refunded");
  assert.equal(state.commitCalls, 0);
});

test("chat defaults legal retrieval to the current Iran-local date and still fails closed", async () => {
  const { handler, calls, state } = loadChatHandler();
  const res = response();
  await handler(request({}), res);
  assert.equal(res.statusCode, 503);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.asOfDate, "2026-11-21");
  assert.equal(res.body.legal_as_of_date, "2026-11-21");
  assert.equal(state.aiCalls, 0);
  assert.equal(state.refundCalls, 1);
});

test("chat rejects invalid reference dates before quota or AI work", async () => {
  const { handler, calls, state } = loadChatHandler();
  const res = response();
  await handler(request({ as_of_date: "۱۴۰۵/۱۲/۳۰" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "INVALID_AS_OF_DATE");
  assert.equal(calls.length, 0);
  assert.equal(state.aiCalls, 0);
  assert.equal(state.reserveCalls, 0);
  assert.equal(state.refundCalls, 0);
});

test("chat distinguishes retrieval outage from an empty verified corpus", async () => {
  const { handler, state } = loadChatHandler({ retrievalStatus: "retrieval_unavailable" });
  const res = response();
  await handler(request({}), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "LEGAL_RETRIEVAL_UNAVAILABLE");
  assert.equal(res.body.legal_evidence_status, "retrieval_unavailable");
  assert.equal(state.aiCalls, 0);
  assert.equal(state.refundCalls, 1);
});

test("chat converts retrieval exceptions into a fail-closed response and refunds credits", async () => {
  const { handler, state } = loadChatHandler({ throwRetrieval: true });
  const res = response();
  await handler(request({}), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "LEGAL_RETRIEVAL_UNAVAILABLE");
  assert.equal(state.aiCalls, 0);
  assert.equal(state.refundCalls, 1);
});

test("chat rejects a verified status with empty evidence instead of trusting the status label", async () => {
  const { handler, state } = loadChatHandler({ retrievalStatus: "verified_sources", evidence: false });
  const res = response();
  await handler(request({}), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "LEGAL_EVIDENCE_UNAVAILABLE");
  assert.equal(state.aiCalls, 0);
  assert.equal(state.refundCalls, 1);
});

test("chat rejects model answers with uncited paragraphs and refunds credits", async () => {
  const { handler, state } = loadChatHandler({
    retrievalStatus: "verified_sources",
    reply: "یک ادعای حقوقی بدون ارجاع"
  });
  const res = response();
  await handler(request({}), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "UNVERIFIED_ANSWER_EVIDENCE");
  assert.equal(state.aiCalls, 1);
  assert.equal(state.refundCalls, 1);
  assert.equal(state.commitCalls, 0);
});

test("chat rejects invented verbatim excerpts and refunds credits", async () => {
  const { handler, state } = loadChatHandler({
    retrievalStatus: "verified_sources",
    reply: "گزیده مستقیم از متن سند (بدون تفسیر حقوقی): [[source:verified-test-source]] [[quote:verified-test-source]] «این نقل قول ساختگی و در متن سند آزمایشی وجود ندارد»"
  });
  const res = response();
  await handler(request({}), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "UNVERIFIED_ANSWER_EVIDENCE");
  assert.equal(state.refundCalls, 1);
  assert.equal(state.commitCalls, 0);
});

test("chat rejects fabricated source IDs even when the answer contains a citation marker", async () => {
  const { handler, state } = loadChatHandler({
    retrievalStatus: "verified_sources",
    reply: "گزیده مستقیم از متن سند (بدون تفسیر حقوقی): [[source:invented-source]] [[quote:invented-source]] «متن رسمی آزمایشی درباره تعهدات قراردادی و مسئولیت مدنی»"
  });
  const res = response();
  await handler(request({}), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "UNVERIFIED_ANSWER_EVIDENCE");
  assert.equal(state.refundCalls, 1);
  assert.equal(state.commitCalls, 0);
});

test("chat calls the model only when verified sources and evidence are both present", async () => {
  const { handler, state } = loadChatHandler({ retrievalStatus: "verified_sources" });
  const res = response();
  await handler(request({}), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, "گزیده مستقیم از متن سند (بدون تفسیر حقوقی): [[source:verified-test-source]] [[quote:verified-test-source]] «متن رسمی آزمایشی درباره تعهدات قراردادی و مسئولیت مدنی»");
  assert.equal(res.body.legal_evidence_status, "verified_sources");
  assert.equal(state.aiCalls, 1);
  assert.equal(state.refundCalls, 0);
  assert.equal(state.commitCalls, 1);
  assert.equal(state.messages.map(item => item.role).join(","), "system,user,user");
  assert.equal(state.messages[1].content, "verified evidence");
});
