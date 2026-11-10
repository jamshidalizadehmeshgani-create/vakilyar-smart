const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("all public entry pages and their internal navigation targets exist", () => {
  const pages = [
    "index.html", "ask-lawyer.html", "lawyer-login.html", "lawyer-panel.html",
    "admin-lawyers.html", "admin-credits.html", "privacy.html", "terms.html", "user-register.html", "user-login.html", "user-forgot-password.html", "user-reset-password.html"
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

test("browser pages call API routes registered by the consolidated serverless router", () => {
  const pages = ["index.html", "ask-lawyer.html", "lawyer-login.html", "lawyer-panel.html", "admin-lawyers.html", "admin-credits.html", "user-register.html", "user-login.html", "user-forgot-password.html", "user-reset-password.html"];
  const endpoints = new Set();
  for (const page of pages) {
    const html = read("public/" + page);
    for (const match of html.matchAll(/fetch\(["'](\/api\/[^"'?]+)["']/g)) endpoints.add(match[1]);
  }
  assert.ok(endpoints.size >= 8, "Expected the public UI to exercise its API contracts");

  const router = read("api/index.js");
  const registered = new Map(
    [...router.matchAll(/\["([^"]+)", require\("\.\.\/handlers\/([^"]+)"\)\]/g)]
      .map(match => [match[1], match[2]])
  );
  assert.ok(fs.existsSync(path.join(root, "api/index.js")), "Consolidated API function is missing");
  for (const endpoint of endpoints) {
    const route = endpoint.replace(/^\/api\//, "");
    assert.ok(registered.has(route), "UI references an unregistered API route: " + endpoint);
    const handler = path.join(root, "handlers", registered.get(route) + ".js");
    assert.ok(fs.existsSync(handler), "API handler file is missing: " + handler);
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


test("question submission UI retains a stable retry ID across reloads", () => {
  const ask=read("public/ask-lawyer.html");
  assert.match(ask,/sessionStorage\.getItem\("vy_pending_question"\)/);
  assert.match(ask,/sessionStorage\.setItem\("vy_pending_question"/);
  assert.match(ask,/request_id:pendingQuestion\.id/);
  assert.match(ask,/برای جلوگیری از ثبت پرسش تکراری/);
});

test("lawyer reply UI retains the same operation ID after an uncertain network result", () => {
  const panel=read("public/lawyer-panel.html");
  assert.match(panel,/vy_pending_reply_/);
  assert.match(panel,/sessionStorage\.setItem\(pendingKey/);
  assert.match(panel,/sessionStorage\.getItem\(pendingKey/);
  assert.match(panel,/request_id:pendingReply\.id/);
  assert.match(panel,/برای جلوگیری از ثبت پاسخ تکراری/);
});

test("all public pages declare Persian RTL document metadata", () => {
  const pages = [
    "index.html", "ask-lawyer.html", "lawyer-login.html", "lawyer-panel.html",
    "admin-lawyers.html", "admin-credits.html", "privacy.html", "terms.html", "user-register.html", "user-login.html", "user-forgot-password.html", "user-reset-password.html"
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
    assert.doesNotMatch(html, /localStorage/);
    assert.doesNotMatch(html, /sessionStorage\.(?:setItem|getItem)\(["'](?:adminKey|ADMIN_API_KEY|key)["']/i);
    assert.match(html, /autocomplete=["']off["']/);
  }
  assert.match(credits, /sessionStorage\.setItem\(["']vy_pending_credit_grant["']/);
  assert.match(credits, /sessionStorage\.getItem\(["']vy_pending_credit_grant["']/);
});


test("lawyer login form mirrors server input limits and prevents duplicate submits", () => {
  const login = read("public/lawyer-login.html");
  assert.match(login, /id="email" type="email"[^>]*maxlength="190"/);
  assert.match(login, /id="password" type="password"[^>]*maxlength="200"/);
  assert.match(login, /autocomplete="username"/);
  assert.match(login, /autocomplete="current-password"/);
  assert.match(login, /button\.disabled=true/);
  assert.match(login, /finally\{button\.disabled=false;\}/);
  assert.match(login, /aria-live="polite"/);
});


test("lawyer question form announces submission feedback accessibly", () => {
  const ask = read("public/ask-lawyer.html");
  assert.match(ask, /id="msg"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(ask, /<textarea id="question" minlength="5" maxlength="5000" required>/);
  assert.match(ask, /<select id="lawyer" required>/);
  assert.match(ask, /<input type="checkbox" id="consent" required>/);
});


test("lawyer reply feedback uses an accessible live status instead of alert dialogs", () => {
  const panel = read("public/lawyer-panel.html");
  assert.match(panel, /const feedback=el\("p","muted",""\)/);
  assert.match(panel, /feedback\.setAttribute\("role","status"\)/);
  assert.match(panel, /feedback\.setAttribute\("aria-live","polite"\)/);
  assert.match(panel, /card\.append\(area,send,feedback\)/);
  assert.doesNotMatch(panel, /alert\(dd\.message/);
});


test("admin panels announce operation results and prevent repeated lawyer-management clicks", () => {
  const lawyers = read("public/admin-lawyers.html");
  const credits = read("public/admin-credits.html");
  for (const html of [lawyers, credits]) {
    assert.match(html, /id="result"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  }
  assert.match(lawyers, /controls\.forEach\(button=>button\.disabled=true\)/);
  assert.match(lawyers, /finally\{controls\.forEach\(button=>button\.disabled=false\);\}/);
});

test("all public pages avoid dangerous HTML parsing and dynamic code execution sinks", () => {
  const publicDir = path.join(root, "public");
  const pages = fs.readdirSync(publicDir).filter(file => file.endsWith(".html"));
  assert.ok(pages.length >= 8, "Expected the complete public HTML page set");

  const forbidden = [
    [/\.innerHTML\s*=/, "innerHTML assignment"],
    [/\.outerHTML\s*=/, "outerHTML assignment"],
    [/\.insertAdjacentHTML\s*\(/, "insertAdjacentHTML"],
    [/document\.write\s*\(/, "document.write"],
    [/\beval\s*\(/, "eval"],
    [/\bnew\s+Function\s*\(/, "dynamic Function constructor"]
  ];

  for (const page of pages) {
    const html = read("public/" + page);
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(html, pattern, page + " contains unsafe " + label);
    }
  }
});


test("password recovery navigation and pages preserve the safe reset-link flow", () => {
  const login = read("public/user-login.html");
  const forgot = read("public/user-forgot-password.html");
  const reset = read("public/user-reset-password.html");
  assert.match(login, /href="\/user-forgot-password\.html"/);
  assert.match(forgot, /id="request"/);
  assert.match(forgot, /\/api\/users\/request-password-reset/);
  assert.match(reset, /name="referrer" content="no-referrer"/);
  assert.match(reset, /history\.replaceState\(null,"",location\.pathname\)/);
  assert.match(reset, /\/api\/users\/reset-password/);
  assert.match(reset, /autocomplete="new-password"/);
  assert.match(reset, /نشست‌های قبلی/);
});


test("public user login and password reset pages expose accessible show/hide controls", () => {
  const login = read("public/user-login.html");
  const reset = read("public/user-reset-password.html");
  assert.match(login, /<button\b(?=[^>]*id="togglePassword")(?=[^>]*type="button")/);
  assert.match(login, /aria-controls="password"/);
  assert.match(login, /aria-pressed="false"/);
  assert.match(login, /passwordToggle\.addEventListener\("click"/);
  assert.match(reset, /data-toggle="password"/);
  assert.match(reset, /data-toggle="confirm"/);
  assert.match(reset, /aria-controls="password"/);
  assert.match(reset, /aria-controls="confirm"/);
  assert.match(reset, /querySelectorAll\("\[data-toggle\]"\)/);
  assert.match(reset, /field\.focus\(\{preventScroll:true\}\)/);
});
