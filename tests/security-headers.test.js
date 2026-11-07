const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadHeaders() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8"));
  return new Map(
    (config.headers || [])
      .flatMap(rule => rule.headers || [])
      .map(header => [String(header.key).toLowerCase(), String(header.value)])
  );
}

test("Vercel config includes baseline browser security headers", () => {
  const headers = loadHeaders();

  assert.match(headers.get("strict-transport-security") || "", /^max-age=31536000(?:; includeSubDomains)?$/);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
});

test("Vercel security headers enforce same-origin isolation and disable legacy cross-domain policies", () => {
  const headers = loadHeaders();

  assert.equal(headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(headers.get("x-permitted-cross-domain-policies"), "none");
});

test("Content Security Policy keeps required restrictions and avoids wildcard sources", () => {
  const headers = loadHeaders();
  const csp = headers.get("content-security-policy") || "";
  const directives = new Map(
    csp.split(";").map(part => part.trim()).filter(Boolean).map(part => {
      const [name, ...sources] = part.split(/\\s+/);
      return [name, sources];
    })
  );

  assert.deepEqual(directives.get("default-src"), ["'self'"]);
  assert.deepEqual(directives.get("base-uri"), ["'self'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directives.get("form-action"), ["'self'"]);
  assert.ok(directives.get("script-src")?.includes("'self'"));
  assert.ok(directives.get("style-src")?.includes("'self'"));
  assert.ok(directives.get("connect-src")?.includes("'self'"));
  assert.ok(directives.get("img-src")?.includes("'self'"));
  assert.ok(directives.get("font-src")?.includes("'self'"));
  assert.ok([...directives.values()].every(sources => !sources.includes("*")));
});
