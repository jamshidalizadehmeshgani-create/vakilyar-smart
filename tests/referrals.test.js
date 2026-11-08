const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("verified users receive one stable, non-identifying referral code", async () => {
  const originalFetch = global.fetch;
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  };
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  const uid = "a".repeat(48);
  const accountKey = "vy:user:account:" + uid;
  const store = new Map([[accountKey, JSON.stringify({
    uid, email: "inviter@example.test", email_verified: true
  })]]);
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    assert.equal(command[0], "EVAL");
    const script = command[1], accountRedisKey = command[3], codeRedisKey = command[4];
    const ownerUid = command[5], proposedCode = command[6];
    const account = JSON.parse(store.get(accountRedisKey));
    let result;
    if (account.referral_code) result = account.referral_code;
    else if (store.has(codeRedisKey)) result = "";
    else {
      account.referral_code = proposedCode;
      account.referral_successful_count = 0;
      account.referral_credits_earned = 0;
      store.set(accountRedisKey, JSON.stringify(account));
      store.set(codeRedisKey, ownerUid);
      result = proposedCode;
    }
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  try {
    const { getOrCreateReferralCode } = require("../lib/referrals");
    const first = await getOrCreateReferralCode(uid);
    const second = await getOrCreateReferralCode(uid);
    assert.match(first, /^[A-Z2-9]{10}$/);
    assert.equal(second, first);
    assert.notEqual(first, uid);
    assert.equal(store.get("vy:referral:code:" + first), uid);
    const saved = JSON.parse(store.get(accountKey));
    assert.equal(saved.referral_code, first);
    assert.equal(saved.referral_successful_count, 0);
  } finally {
    global.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  }
});

test("referral rewards are fixed, capped and granted inside email verification", () => {
  const referral = require("../lib/referrals");
  assert.equal(referral.REFERRAL_REWARD, 250);
  assert.equal(referral.REFERRAL_MAX_REWARDS, 5);
  const verify = fs.readFileSync(require.resolve("../api/users/verify"), "utf8");
  const register = fs.readFileSync(require.resolve("../api/users/register"), "utf8");
  const profile = fs.readFileSync(require.resolve("../api/users/me"), "utf8");
  assert.match(verify, /INCRBY/);
  assert.match(verify, /referral_successful_count/);
  assert.match(verify, /vy:referral:rewarded:/);
  assert.match(verify, /REFERRAL_MAX_REWARDS/);
  assert.match(register, /referred_by_uid/);
  assert.match(register, /referrerUid === accountIdentity\.uid/);
  assert.match(profile, /referral_url/);
});
