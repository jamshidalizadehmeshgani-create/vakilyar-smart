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

test("public AI legal question flow requires consent and lawyer intake stays inactive", () => {
  const ask = read("public/ask-lawyer.html");
  const home = read("public/index.html");
  assert.match(ask, /این قابلیت در نسخه فعلی وکیل‌یار هنوز فعال نیست/);
  assert.doesNotMatch(ask, /<form|fetch\(/i);
  assert.match(home, /if\s*\(!consentEl\.checked\)/);
  assert.match(home, /answerEl\.textContent\s*=\s*data\.reply/);
});

test("lawyer intake and panel pages clearly state that lawyer services are inactive", () => {
  const ask = read("public/ask-lawyer.html");
  const login = read("public/lawyer-login.html");
  const panel = read("public/lawyer-panel.html");
  assert.match(ask, /هیچ پرسشی به وکیل ارسال نمی‌شود/);
  assert.match(login, /ورود وکیل در نسخه فعلی وکیل‌یار غیرفعال است/);
  assert.match(panel, /پنل وکیل در نسخه فعلی غیرفعال است/);
  for (const page of [ask, login, panel]) {
    assert.doesNotMatch(page, /<form|fetch\(/i);
    assert.match(page, /name="robots" content="noindex"/);
  }
});


test("disabled lawyer intake cannot retain or submit pending questions", () => {
  const ask=read("public/ask-lawyer.html");
  assert.doesNotMatch(ask,/vy_pending_question|api\/questions\/create|fetch\(/);
  assert.match(ask,/امکان ثبت یا انتخاب وکیل در این بخش وجود ندارد/);
});

test("disabled lawyer panel cannot load inboxes or submit replies", () => {
  const panel=read("public/lawyer-panel.html");
  assert.doesNotMatch(panel,/api\/lawyer\/(?:me|questions|reply)|fetch\(/);
  assert.match(panel,/هیچ پرسشی در این نسخه به وکیل ارجاع داده نمی‌شود/);
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


test("disabled lawyer login has no form or authentication request", () => {
  const login = read("public/lawyer-login.html");
  assert.match(login, /ورود وکیل در نسخه فعلی وکیل‌یار غیرفعال است/);
  assert.doesNotMatch(login, /<form|fetch\(|api\/lawyer\/login/i);
});


test("disabled lawyer intake exposes no question form or submission controls", () => {
  const ask = read("public/ask-lawyer.html");
  assert.match(ask, /این قابلیت در نسخه فعلی وکیل‌یار هنوز فعال نیست/);
  assert.doesNotMatch(ask, /<form|<textarea|<select|api\/questions\//i);
});


test("disabled lawyer panel exposes no reply controls or API calls", () => {
  const panel = read("public/lawyer-panel.html");
  assert.doesNotMatch(panel, /<textarea|fetch\(|api\/lawyer\//i);
  assert.match(panel, /پنل وکیل در نسخه فعلی غیرفعال است/);
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


test("administrator secret fields and dynamically created lawyer passwords have accessible visibility controls", () => {
  const lawyers = read("public/admin-lawyers.html");
  const credits = read("public/admin-credits.html");
  assert.match(lawyers, /data-password-toggle="key"/);
  assert.match(lawyers, /attachPasswordToggle\(\$\("key"\)/);
  assert.match(lawyers, /const passWrap=attachPasswordToggle\(pass,"رمز وکیل"\)/);
  assert.match(lawyers, /box\.append\(title,detail,btn,passWrap,setPass\)/);
  assert.match(lawyers, /toggle\.setAttribute\("aria-pressed"/);
  assert.match(credits, /id="toggleAdminKey"[^>]*aria-controls="adminKey"/);
  assert.match(credits, /toggleAdminKey\.addEventListener\("click"/);
  assert.doesNotMatch(lawyers, /localStorage/);
  assert.doesNotMatch(credits, /localStorage/);
});
