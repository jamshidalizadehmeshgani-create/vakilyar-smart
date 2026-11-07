const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
process.env.ADMIN_API_KEY = "test-admin-key";

const values = new Map();
const lists = new Map();
const expirations = new Map();
let throwAfterReserve = false;
let throwAfterRefund = false;

global.fetch = async (_url, options) => {
  const command = JSON.parse(options.body);
  const [op, ...args] = command;
  let result = null;

  if (op === "PING") {
    result = "PONG";
  } else if (op === "GET") {
    result = values.has(args[0]) ? values.get(args[0]) : null;
  } else if (op === "SET") {
    values.set(args[0], String(args[1]));
    result = "OK";
  } else if (op === "DEL") {
    result = 0;
    for (const key of args) if (values.delete(key)) result++;
  } else if (op === "LPUSH") {
    const list = lists.get(args[0]) || [];
    list.unshift(String(args[1]));
    lists.set(args[0], list);
    result = list.length;
  } else if (op === "LTRIM") {
    const list = lists.get(args[0]) || [];
    const start = Number(args[1]);
    const end = Number(args[2]);
    lists.set(args[0], list.slice(start, end < 0 ? undefined : end + 1));
    result = "OK";
  } else if (op === "LRANGE") {
    const list = lists.get(args[0]) || [];
    const start = Number(args[1]);
    const end = Number(args[2]);
    result = list.slice(start, end < 0 ? undefined : end + 1);
  } else if (op === "LREM") {
    const list = lists.get(args[0]) || [];
    const count = Number(args[1]);
    const value = String(args[2]);
    let removed = 0;
    const next = [];
    for (const item of list) {
      if (item === value && (count === 0 || removed < Math.abs(count))) removed++;
      else next.push(item);
    }
    lists.set(args[0], next);
    result = removed;
  } else if (op === "EVAL" && String(args[0]).includes("lawyer.password_hash=ARGV[2]")) {
    const key = args[2], id = args[3], passwordHash = args[4], updatedAt = args[5];
    const raw = values.get(key);
    if (!raw) result = -1;
    else {
      let lawyer;
      try { lawyer = JSON.parse(raw); } catch { lawyer = null; }
      if (!lawyer || lawyer.id !== id) result = -2;
      else {
        lawyer.password_hash = passwordHash;
        lawyer.password_updated_at = updatedAt;
        values.set(key, JSON.stringify(lawyer));
        result = 1;
      }
    }
  } else if (op === "EVAL" && String(args[0]).includes("lawyer.access=ARGV[2]")) {
    const key = args[2], id = args[3], access = args[4], updatedAt = args[5];
    const raw = values.get(key);
    if (!raw) result = -1;
    else {
      let lawyer;
      try { lawyer = JSON.parse(raw); } catch { lawyer = null; }
      if (!lawyer || lawyer.id !== id) result = -2;
      else {
        lawyer.access = access;
        lawyer.access_updated_at = updatedAt;
        values.set(key, JSON.stringify(lawyer));
        result = 1;
      }
    }
  } else if (op === "EVAL" && String(args[0]).includes("DELETE_OWNED_QUESTION")) {
    const questionKey = args[2], userListKey = args[3], lawyerListKey = args[4];
    const userId = args[5], questionId = args[6], removeLawyer = args[7] === "1";
    const raw = values.get(questionKey);
    if (!raw) result = 0;
    else {
      let question;
      try { question = JSON.parse(raw); } catch { question = null; }
      if (!question || question.user_id !== userId) result = -1;
      else {
        values.delete(questionKey);
        for (const key of [userListKey, ...(removeLawyer ? [lawyerListKey] : [])]) {
          const list = lists.get(key) || [];
          lists.set(key, list.filter(item => item !== questionId));
        }
        result = 1;
      }
    }
  } else if (op === "EVAL" && String(args[0]).includes("redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[3])")) {
    const questionKey = args[2], lawyerListKey = args[3], userListKey = args[4];
    const item = args[5], id = args[6];
    values.set(questionKey, item);
    for (const key of [lawyerListKey, userListKey]) {
      const list = lists.get(key) || [];
      list.unshift(String(id));
      lists.set(key, list.slice(0, 500));
    }
    result = 1;
  } else if (op === "EVAL" && String(args[0]).includes("q.replies=q.replies or {}")) {
    const questionKey = args[2], auditKey = args[3], lawyerId = args[4];
    const reply = JSON.parse(args[5]), at = args[6], audit = args[7];
    const raw = values.get(questionKey);
    if (!raw) result = -1;
    else {
      const q = JSON.parse(raw);
      if (q.lawyer_id !== lawyerId) result = -3;
      else {
        q.replies = q.replies || [];
        q.replies.push(reply);
        q.status = "answered";
        q.updated_at = at;
        values.set(questionKey, JSON.stringify(q));
        const list = lists.get(auditKey) || [];
        list.unshift(audit);
        lists.set(auditKey, list.slice(0, 500));
        result = 1;
      }
    }
  } else if (op === "EVAL" && String(args[0]).includes("local v=redis.call('GET',KEYS[1]); if not v then redis.call('SET',KEYS[1],ARGV[1])")) {
    const key = args[2], initial = args[3];
    if (!values.has(key)) values.set(key, String(initial));
    result = Number(values.get(key));
  } else if (op === "EVAL" && String(args[0]).includes("INCR") && String(args[0]).includes("EXPIRE")) {
    const key = args[2];
    const count = Number(values.get(key) || 0) + 1;
    values.set(key, String(count));
    if (count === 1) expirations.set(key, Number(args[3]));
    result = count;
  } else if (op === "EVAL" && String(args[0]).includes("DECRBY")) {
    const balanceKey = args[2], reservationKey = args[3], commitKey = args[4], refundKey = args[5];
    const cost = Number(args[6]);
    let balance = Number(values.get(balanceKey) || 0);
    if (values.has(commitKey) || values.has(refundKey)) result = -3;
    else if (values.has(reservationKey)) result = balance;
    else if (!values.has(balanceKey)) result = -2;
    else if (balance < cost) result = -1;
    else {
      balance -= cost;
      values.set(balanceKey, String(balance));
      values.set(reservationKey, String(cost));
      result = balance;
      if (throwAfterReserve) {
        throwAfterReserve = false;
        throw new Error("simulated timeout after Redis applied reservation");
      }
    }
  } else if (op === "EVAL" && String(args[0]).includes("INCRBY")) {
    const balanceKey = args[2], reservationKey = args[3], refundKey = args[4], commitKey = args[5];
    if (values.has(commitKey)) result = 0;
    else if (!values.has(reservationKey)) result = 0;
    else if (!values.has(refundKey)) {
      const balance = Number(values.get(balanceKey) || 0) + Number(values.get(reservationKey));
      values.set(refundKey, "1");
      values.set(balanceKey, String(balance));
      values.delete(reservationKey);
      result = balance;
      if (throwAfterRefund) {
        throwAfterRefund = false;
        throw new Error("simulated timeout after Redis applied refund");
      }
    } else result = Number(values.get(balanceKey) || 0);
  } else if (op === "EVAL") {
    const reservationKey = args[2], commitKey = args[3], refundKey = args[4];
    if (values.has(refundKey)) result = 0;
    else if (values.has(commitKey)) result = 1;
    else if (!values.has(reservationKey)) result = 0;
    else {
      values.set(commitKey, "1");
      values.delete(reservationKey);
      result = 1;
    }
  } else {
    throw new Error("Unsupported test Redis command: " + op);
  }

  return { ok: true, json: async () => ({ result }) };
};

const { reserveCredits, refundReservation, commitReservation, redis } = require("../lib/quota");
const adminLawyers = require("../api/admin/lawyers");
const grantCredits = require("../api/admin/grant-credits");
const createQuestion = require("../api/questions/create");
const loginLawyer = require("../api/lawyer/login");
const { getLawyerSession, hashToken } = require("../lib/lawyer-auth");

function responseMock() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("an ambiguous reservation timeout can be safely refunded", async () => {
  values.set("test:credits", "100");
  throwAfterReserve = true;
  const id = "a".repeat(32);

  await assert.rejects(reserveCredits("test:credits", 10, id), /Redis transport failed/);
  assert.equal(values.get("test:credits"), "90");
  await refundReservation("test:credits", id);
  await refundReservation("test:credits", id);

  assert.equal(values.get("test:credits"), "100");
});

test("an ambiguous refund timeout cannot credit the same reservation twice", async () => {
  values.set("test:credits", "100");
  const id = "b".repeat(32);
  assert.equal(await reserveCredits("test:credits", 10, id), 90);
  throwAfterRefund = true;

  await assert.rejects(refundReservation("test:credits", id), /Redis transport failed/);
  await refundReservation("test:credits", id);

  assert.equal(values.get("test:credits"), "100");
});

test("committed reservations cannot later be refunded", async () => {
  values.set("test:credits", "100");
  const id = "e".repeat(32);
  assert.equal(await reserveCredits("test:credits", 10, id), 90);
  assert.equal(await commitReservation(id), 1);
  assert.equal(await commitReservation(id), 1);
  assert.equal(await refundReservation("test:credits", id), 0);
  assert.equal(values.get("test:credits"), "90");
});

test("reservation helpers reject invalid identifiers and amounts", async () => {
  await assert.rejects(reserveCredits("test:credits", 10, "bad-id"), /Invalid credit reservation/);
  await assert.rejects(reserveCredits("test:credits", 0, "f".repeat(32)), /Invalid credit reservation/);
  await assert.rejects(refundReservation("test:credits", "bad-id"), /Invalid credit reservation/);
});

test("admin can disable a lawyer and the existing session and new questions are blocked", async () => {
  const lawyerId = "c".repeat(32);
  const token = "d".repeat(64);
  values.set("vy:lawyer:" + lawyerId, JSON.stringify({
    id: lawyerId, name: "وکیل آزمایشی", email: "lawyer@example.test", access: "active"
  }));
  values.set("vy:lawyer:session:" + hashToken(token), lawyerId);

  const adminRes = responseMock();
  await adminLawyers({
    method: "POST",
    headers: { authorization: "Bearer test-admin-key" },
    body: { action: "set_access", lawyer_id: lawyerId, enabled: false }
  }, adminRes);

  assert.equal(adminRes.statusCode, 200);
  assert.equal(adminRes.body.lawyer.access, "disabled");

  const auditRes = responseMock();
  await adminLawyers({ method: "POST", headers: { authorization: "Bearer test-admin-key" }, body: { action: "audit" } }, auditRes);
  assert.equal(auditRes.statusCode, 200);
  assert.ok(auditRes.body.events.some(event => event.action === "lawyer_access_disabled" && event.lawyer_id === lawyerId));

  const sessionRes = responseMock();
  const session = await getLawyerSession({ headers: { cookie: "vy_lawyer_session=" + token } }, sessionRes);
  assert.equal(session, null);
  assert.match(sessionRes.headers["Set-Cookie"], /Max-Age=0/);

  const questionRes = responseMock();
  await createQuestion({
    method: "POST",
    headers: { host: "app.example.test", origin: "https://app.example.test", "sec-fetch-site": "same-origin" },
    body: { consent: true, lawyer_id: lawyerId, question: "پرسش آزمایشی برای وکیل" }
  }, questionRes);
  assert.equal(questionRes.statusCode, 403);
});

test("admin password reset atomically preserves concurrent lawyer profile fields", async () => {
  const lawyerId = "2".repeat(32);
  values.set("vy:lawyer:" + lawyerId, JSON.stringify({
    id: lawyerId, name: "وکیل آزمایشی", email: "lawyer2@example.test", access: "active"
  }));
  const res = responseMock();
  await adminLawyers({
    method: "POST",
    headers: { authorization: "Bearer test-admin-key" },
    body: { action: "set_password", lawyer_id: lawyerId, password: "a-strong-test-password" }
  }, res);
  assert.equal(res.statusCode, 200);
  const saved = JSON.parse(values.get("vy:lawyer:" + lawyerId));
  assert.equal(saved.access, "active");
  assert.match(saved.password_hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.ok(saved.password_updated_at);
});

test("configuration diagnostics expose readiness flags without secret values", async () => {
  const res = responseMock();
  await adminLawyers({
    method: "POST",
    headers: { authorization: "Bearer test-admin-key" },
    body: { action: "config" }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.configuration.redis_connection, true);
  assert.equal(res.body.configuration.ai_api_key_present, false);
  assert.equal(JSON.stringify(res.body).includes("test-admin-key"), false);
});

test("unlimited gift and Pro access remain independent", async () => {
  const userId = "f".repeat(48);
  const headers = { authorization: "Bearer test-admin-key" };
  const unlimitedRes = responseMock();
  await grantCredits({ method: "POST", headers, body: { user_id: userId, unlimited: true } }, unlimitedRes);
  assert.equal(unlimitedRes.statusCode, 200);
  assert.equal(values.get("vy:user:" + userId + ":unlimited"), "active");
  assert.equal(values.has("vy:user:" + userId + ":pro"), false);

  const proRes = responseMock();
  await grantCredits({ method: "POST", headers, body: { user_id: userId, action: "set_pro", active: true } }, proRes);
  assert.equal(proRes.statusCode, 200);
  assert.equal(values.get("vy:user:" + userId + ":pro"), "active");

  const revokeProRes = responseMock();
  await grantCredits({ method: "POST", headers, body: { user_id: userId, action: "set_pro", active: false } }, revokeProRes);
  assert.equal(revokeProRes.statusCode, 200);
  assert.equal(values.has("vy:user:" + userId + ":pro"), false);
  assert.equal(values.get("vy:user:" + userId + ":unlimited"), "active");
});

test("unlimited credits do not bypass the foreign-law Pro gate", async () => {
  const quota = require("../lib/quota");
  const originalGetAccount = quota.getAccount;
  quota.getAccount = async () => ({
    uid: "1".repeat(48), key: "vy:user:" + "1".repeat(48) + ":credits",
    credits: 1000, isPro: false, isUnlimited: true
  });
  process.env.AI_API_KEY = "test-ai-key";
  delete require.cache[require.resolve("../api/chat")];
  const chat = require("../api/chat");
  const res = responseMock();
  try {
    await chat({
      method: "POST",
      headers: { host: "app.example.test", origin: "https://app.example.test", "sec-fetch-site": "same-origin" },
      body: { consent: true, message: "قوانین آلمان را توضیح بده" }
    }, res);
  } finally {
    quota.getAccount = originalGetAccount;
    delete require.cache[require.resolve("../api/chat")];
    delete process.env.AI_API_KEY;
  }
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "PRO_REQUIRED");
});

test("lawyer question retention uses a validated default and preserves expiry on replies", async () => {
  const { questionRetentionSeconds } = require("../api/questions/create");
  assert.equal(questionRetentionSeconds(undefined), 90 * 86400);
  assert.equal(questionRetentionSeconds("30"), 30 * 86400);
  assert.throws(() => questionRetentionSeconds("0"), /QUESTION_RETENTION_DAYS/);
  assert.throws(() => questionRetentionSeconds("3651"), /QUESTION_RETENTION_DAYS/);
  const replySource = require("fs").readFileSync(require.resolve("../api/lawyer/reply"), "utf8");
  assert.match(replySource, /'KEEPTTL'/);
});

test("daily lawyer-question counter increments through one atomic Redis operation", async () => {
  const { incrementDailyQuestionCount } = require("../api/questions/create");
  const key = "vy:user:" + "9".repeat(48) + ":question-limit";
  assert.equal(await incrementDailyQuestionCount(key), 1);
  assert.equal(await incrementDailyQuestionCount(key), 2);
  assert.equal(values.get(key), "2");
});

test("lawyer login rate limits increment atomically with a bounded TTL", async () => {
  const { incrementLoginAttempts } = loginLawyer;
  const emailKey = "vy:lawyer:login-attempts:" + "a".repeat(64);
  const ipKey = "vy:lawyer:login-ip-attempts:" + "b".repeat(64);
  assert.equal(await incrementLoginAttempts(emailKey, 900), 1);
  assert.equal(await incrementLoginAttempts(emailKey, 900), 2);
  assert.equal(await incrementLoginAttempts(ipKey, 900), 1);
  assert.equal(values.get(emailKey), "2");
  assert.equal(values.get(ipKey), "1");
  assert.equal(expirations.get(emailKey), 900);
  assert.equal(expirations.get(ipKey), 900);
  await assert.rejects(incrementLoginAttempts("", 900), /Invalid login rate-limit configuration/);
  await assert.rejects(incrementLoginAttempts("valid:key", 0), /Invalid login rate-limit configuration/);
});


test("question deletion atomically verifies ownership and removes both indexes", async () => {
  const { deleteOwnedQuestion } = require("../api/questions/mine");
  const questionId = "7".repeat(32);
  const userId = "8".repeat(48);
  const lawyerId = "9".repeat(32);
  const questionKey = "vy:question:" + questionId;
  const userListKey = "vy:user:" + userId + ":questions";
  const lawyerListKey = "vy:lawyer:" + lawyerId + ":questions";

  values.set(questionKey, JSON.stringify({ id: questionId, user_id: userId, lawyer_id: lawyerId }));
  lists.set(userListKey, [questionId, "a".repeat(32)]);
  lists.set(lawyerListKey, [questionId, "b".repeat(32)]);

  assert.equal(await deleteOwnedQuestion({
    questionKey, userListKey, lawyerListKey, userId: "0".repeat(48),
    questionId, removeLawyer: true
  }), -1);
  assert.equal(values.has(questionKey), true);
  assert.deepEqual(lists.get(userListKey), [questionId, "a".repeat(32)]);

  assert.equal(await deleteOwnedQuestion({
    questionKey, userListKey, lawyerListKey, userId,
    questionId, removeLawyer: true
  }), 1);
  assert.equal(values.has(questionKey), false);
  assert.deepEqual(lists.get(userListKey), ["a".repeat(32)]);
  assert.deepEqual(lists.get(lawyerListKey), ["b".repeat(32)]);

  assert.equal(await deleteOwnedQuestion({
    questionKey, userListKey, lawyerListKey, userId,
    questionId, removeLawyer: true
  }), 0);
});

test("admin lawyer endpoint rejects an invalid manager key", async () => {
  const res = responseMock();
  await adminLawyers({
    method: "POST",
    headers: { authorization: "Bearer wrong-key" },
    body: { action: "list" }
  }, res);
  assert.equal(res.statusCode, 401);
});


test("stale and expired question IDs are pruned from the user index", async () => {
  const { pruneQuestionIndex } = require("../api/questions/mine");
  const key = "vy:user:" + "6".repeat(48) + ":questions";
  const stale = "a".repeat(32);
  const live = "b".repeat(32);
  lists.set(key, [stale, live, stale]);
  assert.equal(await pruneQuestionIndex(key, [stale, stale, "invalid"]), 2);
  assert.deepEqual(lists.get(key), [live]);
  assert.equal(await pruneQuestionIndex(key, []), 0);
});


test("invalid retention configuration is checked before daily quota mutation", () => {
  const source = require("fs").readFileSync(require.resolve("../api/questions/create"), "utf8");
  const validation = source.indexOf("const retentionSeconds = questionRetentionSeconds();");
  const quotaMutation = source.indexOf("const count = await incrementDailyQuestionCount(limitKey);");
  assert.ok(validation >= 0 && quotaMutation > validation,
    "retention configuration must be validated before incrementing the daily question counter");
  assert.match(source, /String\(retentionSeconds\)/);
});


test("Redis transport exceptions never expose Authorization credentials", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const secret = "sensitive-test-token";
  process.env.UPSTASH_REDIS_REST_TOKEN = secret;
  global.fetch = async () => {
    const error = new TypeError("request failed: " + secret);
    const inner = new Error("socket failure: " + secret);
    inner.cause = Object.assign(new Error("dns failure: " + secret), { code: "ENOTFOUND" });
    error.cause = inner;
    throw error;
  };
  try {
    await assert.rejects(redis(["PING"]), error => {
      assert.equal(error.message, "Redis transport failed (ENOTFOUND)");
      assert.equal(error.message.includes(secret), false);
      return true;
    });
  } finally {
    global.fetch = originalFetch;
    process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  }
});


test("user-to-lawyer question lifecycle works across create, inbox, reply, history, and owned deletion", async () => {
  process.env.APP_SECRET = "test-app-secret-for-question-lifecycle";
  const userId = "a".repeat(48);
  const signature = crypto.createHmac("sha256", process.env.APP_SECRET).update(userId).digest("base64url");
  const userCookie = "vy_uid=" + userId + "." + signature;
  const lawyerId = "b".repeat(32);
  const lawyerToken = "c".repeat(64);
  const password = "lifecycle-test-password";
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64,
    (err, key) => err ? reject(err) : resolve(salt + ":" + key.toString("hex"))));
  values.set("vy:lawyer:" + lawyerId, JSON.stringify({
    id: lawyerId, name: "وکیل چرخه آزمون", email: "lifecycle@example.test",
    access: "active", password_hash: passwordHash
  }));
  values.set("vy:lawyer:email:" + crypto.createHash("sha256").update("lifecycle@example.test").digest("hex"), lawyerId);

  const sameOrigin = { host: "app.example.test", origin: "https://app.example.test", "sec-fetch-site": "same-origin" };
  const createQuestion = require("../api/questions/create");
  const mine = require("../api/questions/mine");
  const login = require("../api/lawyer/login");
  const me = require("../api/lawyer/me");
  const inbox = require("../api/lawyer/questions");
  const reply = require("../api/lawyer/reply");

  const createRes = responseMock();
  await createQuestion({ method: "POST", headers: { ...sameOrigin, cookie: userCookie },
    body: { consent: true, lawyer_id: lawyerId, question: "شرایط قانونی فسخ قرارداد چیست؟" } }, createRes);
  assert.equal(createRes.statusCode, 201);
  const questionId = createRes.body.question_id;
  assert.match(questionId, /^[a-f0-9]{32}$/);

  const loginRes = responseMock();
  await login({ method: "POST", headers: sameOrigin,
    body: { email: "lifecycle@example.test", password } }, loginRes);
  assert.equal(loginRes.statusCode, 200);
  const sessionCookie = loginRes.headers["Set-Cookie"].split(";")[0];

  const meRes = responseMock();
  await me({ method: "GET", headers: { cookie: sessionCookie } }, meRes);
  assert.equal(meRes.statusCode, 200);
  assert.equal(meRes.body.lawyer.id, lawyerId);

  const inboxRes = responseMock();
  await inbox({ method: "GET", headers: { cookie: sessionCookie } }, inboxRes);
  assert.equal(inboxRes.statusCode, 200);
  assert.equal(inboxRes.body.questions.length, 1);
  assert.equal(inboxRes.body.questions[0].id, questionId);

  const foreignUserId = "d".repeat(48);
  const foreignSignature = crypto.createHmac("sha256", process.env.APP_SECRET).update(foreignUserId).digest("base64url");
  const foreignUserCookie = "vy_uid=" + foreignUserId + "." + foreignSignature;
  const foreignHistoryRes = responseMock();
  await mine({ method: "GET", headers: { cookie: foreignUserCookie } }, foreignHistoryRes);
  assert.equal(foreignHistoryRes.statusCode, 200);
  assert.deepEqual(foreignHistoryRes.body.questions, []);

  const foreignDeleteRes = responseMock();
  await mine({ method: "POST", headers: { ...sameOrigin, cookie: foreignUserCookie },
    body: { question_id: questionId } }, foreignDeleteRes);
  assert.equal(foreignDeleteRes.statusCode, 403);
  assert.equal(values.has("vy:question:" + questionId), true);

  const otherLawyerId = "e".repeat(32);
  const otherLawyerToken = "f".repeat(64);
  values.set("vy:lawyer:" + otherLawyerId, JSON.stringify({
    id: otherLawyerId, name: "وکیل دیگر", email: "other@example.test", access: "active"
  }));
  values.set("vy:lawyer:session:" + hashToken(otherLawyerToken), otherLawyerId);
  const forbiddenReplyRes = responseMock();
  await reply({ method: "POST", headers: { ...sameOrigin, cookie: "vy_lawyer_session=" + otherLawyerToken },
    body: { question_id: questionId, message: "پاسخ غیرمجاز" } }, forbiddenReplyRes);
  assert.equal(forbiddenReplyRes.statusCode, 403);

  const replyRes = responseMock();
  await reply({ method: "POST", headers: { ...sameOrigin, cookie: sessionCookie },
    body: { question_id: questionId, message: "برای پاسخ دقیق، متن قرارداد باید بررسی شود." } }, replyRes);
  assert.equal(replyRes.statusCode, 200);

  const historyRes = responseMock();
  await mine({ method: "GET", headers: { cookie: userCookie } }, historyRes);
  assert.equal(historyRes.statusCode, 200);
  assert.equal(historyRes.body.questions.length, 1);
  assert.equal(historyRes.body.questions[0].status, "answered");
  assert.equal(historyRes.body.questions[0].replies[0].message, "برای پاسخ دقیق، متن قرارداد باید بررسی شود.");

  const deleteRes = responseMock();
  await mine({ method: "POST", headers: { ...sameOrigin, cookie: userCookie },
    body: { question_id: questionId } }, deleteRes);
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(values.has("vy:question:" + questionId), false);
  assert.deepEqual(lists.get("vy:user:" + userId + ":questions"), []);
  assert.deepEqual(lists.get("vy:lawyer:" + lawyerId + ":questions"), []);

  const historyAfterDelete = responseMock();
  await mine({ method: "GET", headers: { cookie: userCookie } }, historyAfterDelete);
  assert.equal(historyAfterDelete.statusCode, 200);
  assert.deepEqual(historyAfterDelete.body.questions, []);
  delete process.env.APP_SECRET;
});
