"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ReadableStream } = require("node:stream/web");
const { fetchOfficialLegalDocument } = require("../lib/legal-official-fetch");

function response(status, headers = {}, bytes = Buffer.from("%PDF-1.7\\nbody\\n%%EOF")) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return headers[name.toLowerCase()] ?? null; } },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      }
    })
  };
}

test("downloads a PDF from an official HTTPS host and computes integrity metadata", async () => {
  const result = await fetchOfficialLegalDocument("https://qavanin.ir/Law/file.pdf", {
    fetchImpl: async () => response(200, { "content-type": "application/pdf" })
  });
  assert.equal(result.metadata.finalUrl, "https://qavanin.ir/Law/file.pdf");
  assert.equal(result.metadata.byteLength, result.bytes.length);
  assert.match(result.metadata.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.metadata.mimeType, "application/pdf");
});

test("records and permits only official HTTPS redirect hops", async () => {
  const seen = [];
  const result = await fetchOfficialLegalDocument("https://qavanin.ir/start", {
    fetchImpl: async url => {
      seen.push(url);
      return url.endsWith("/start")
        ? response(302, { location: "https://www.qavanin.ir/final.pdf" })
        : response(200, { "content-type": "application/pdf" });
    }
  });
  assert.deepEqual(seen, ["https://qavanin.ir/start", "https://www.qavanin.ir/final.pdf"]);
  assert.deepEqual(result.metadata.redirectChain, ["https://www.qavanin.ir/final.pdf"]);
});

test("rejects a redirect to a non-official host before following it", async () => {
  let calls = 0;
  await assert.rejects(() => fetchOfficialLegalDocument("https://qavanin.ir/start", {
    fetchImpl: async () => { calls += 1; return response(302, { location: "https://example.com/file.pdf" }); }
  }), /میزبان غیررسمی/);
  assert.equal(calls, 1);
});

test("rejects non-official source URLs and unsupported content types", async () => {
  await assert.rejects(() => fetchOfficialLegalDocument("https://example.com/file.pdf", {
    fetchImpl: async () => response(200, { "content-type": "application/pdf" })
  }), /رسمی و امن/);
  await assert.rejects(() => fetchOfficialLegalDocument("https://qavanin.ir/file", {
    fetchImpl: async () => response(200, { "content-type": "text/html" }, Buffer.from("<html>"))
  }), /نوع محتوای پاسخ/);
});

test("rejects a PDF response without a PDF signature", async () => {
  await assert.rejects(() => fetchOfficialLegalDocument("https://qavanin.ir/file.pdf", {
    fetchImpl: async () => response(200, { "content-type": "application/pdf" }, Buffer.from("not a pdf"))
  }), /امضای فایل/);
});

test("enforces the response size limit", async () => {
  await assert.rejects(() => fetchOfficialLegalDocument("https://qavanin.ir/file.pdf", {
    maxBytes: 4,
    fetchImpl: async () => response(200, { "content-type": "application/pdf" })
  }), /سقف مجاز/);
});
