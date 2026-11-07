const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("all public entry pages and their internal navigation targets exist", () => {
  const pages = [
    "index.html", "ask-lawyer.html", "lawyer-login.html", "lawyer-panel.html",
    "admin-lawyers.html", "admin-credits.html", "privacy.html", "terms.html"
  ];
  const known = new Set(pages);
  for (const page of pages) assert.ok(fs.existsSync(path.join(root, "public", page)), page + " is missing");

  for (const page of pages) {
    const html = read("public/" + page);
    const links = [...html.matchAll(/href=["']\/([^"'#?]+)["']/g)].map(match => match[1]);
    for (const target of links) {
      if (target.includes(".")) assert.ok(known.has(target), page + " links to missing public page: " + target);
    }
  }
});

test("browser pages call API routes that exist in the serverless API tree", () => {
  const pages = ["index.html", "ask-lawyer.html", "lawyer-login.html", "lawyer-panel.html", "admin-lawyers.html", "admin-credits.html"];
  const endpoints = new Set();
  for (const page of pages) {
    const html = read("public/" + page);
    for (const match of html.matchAll(/fetch\(["'](\/api\/[^"'?]+)["']/g)) endpoints.add(match[1]);
  }
  assert.ok(endpoints.size >= 8, "Expected the public UI to exercise its API contracts");
  for (const endpoint of endpoints) {
    const file = path.join(root, endpoint.replace(/^\/api\//, "api/") + ".js");
    assert.ok(fs.existsSync(file), "UI references missing API route: " + endpoint);
  }
});

test("lawyer question submission requires explicit consent and safe text rendering", () => {
  const ask = read("public/ask-lawyer.html");
  const home = read("public/index.html");
  assert.match(ask, /if\s*\(!\$\("consent"\)\.checked\)/);
  assert.match(home, /if\s*\(!consentEl\.checked\)/);
  assert.match(ask, /p\.textContent\s*=\s*q\.question/);
  assert.match(home, /answerEl\.textContent\s*=\s*data\.reply/);
});

test("question history and lawyer inbox announce updates accessibly", () => {
  assert.match(read("public/ask-lawyer.html"), /id="mine"[^>]*aria-live="polite"/);
  assert.match(read("public/lawyer-panel.html"), /id="questions"[^>]*aria-live="polite"/);
});


test("all public pages declare Persian RTL document metadata", () => {
  const pages = [
    "index.html", "ask-lawyer.html", "lawyer-login.html", "lawyer-panel.html",
    "admin-lawyers.html", "admin-credits.html", "privacy.html", "terms.html"
  ];
  for (const page of pages) {
    const html = read("public/" + page);
    assert.match(html, /<html[^>]*lang=["']fa["']/i, page + " must declare Persian language");
    assert.match(html, /<html[^>]*dir=["']rtl["']/i, page + " must declare RTL direction");
    assert.match(html, /<meta[^>]*name=["']viewport["']/i, page + " must declare a mobile viewport");
  }
});

test("admin panels keep manager credentials in password fields and send them only as bearer headers", () => {
  const lawyers = read("public/admin-lawyers.html");
  const credits = read("public/admin-credits.html");
  assert.match(lawyers, /id="key" type="password"/);
  assert.match(credits, /id="adminKey" type="password"/);
  assert.match(lawyers, /"Authorization":"Bearer "\+key/);
  assert.match(credits, /"Authorization":"Bearer "\+key/);
  for (const [page, html] of [["admin-lawyers.html", lawyers], ["admin-credits.html", credits]]) {
    assert.doesNotMatch(html, /localStorage|sessionStorage/);
    assert.match(html, /autocomplete=["']off["']/);
  }
});
