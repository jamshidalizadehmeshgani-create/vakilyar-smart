const crypto = require("crypto");
const { redis } = require("./quota");

const REFERRAL_REWARD = 250;
const REFERRAL_MAX_REWARDS = 5;
const INITIAL_CREDITS = Number(process.env.FREE_CREDITS_INITIAL || 1000);
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  const bytes = crypto.randomBytes(10);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

async function getOrCreateReferralCode(uid) {
  if (!/^[a-f0-9]{48}$/.test(uid || "")) throw new Error("Invalid referral owner");
  const accountKey = "vy:user:account:" + uid;
  const script = "local raw=redis.call('GET',KEYS[1]); if not raw then return '-1' end; local ok,account=pcall(cjson.decode,raw); if not ok or type(account)~='table' or account.uid~=ARGV[1] or account.email_verified~=true then return '-1' end; if type(account.referral_code)=='string' and account.referral_code~='' then return account.referral_code end; if redis.call('EXISTS',KEYS[2])==1 then return '' end; account.referral_code=ARGV[2]; if account.referral_successful_count==nil then account.referral_successful_count=0 end; if account.referral_credits_earned==nil then account.referral_credits_earned=0 end; redis.call('SET',KEYS[2],ARGV[1]); redis.call('SET',KEYS[1],cjson.encode(account)); return ARGV[2]";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeCode();
    const result = await redis(["EVAL", script, "2", accountKey, "vy:referral:code:" + code, uid, code]);
    if (typeof result === "string" && /^[A-Z2-9]{10}$/.test(result)) return result;
    if (result === "-1") throw new Error("Verified referral account not found");
  }
  throw new Error("Could not allocate a unique referral code");
}

async function applyReferralReward(inviteeUid) {
  if (!/^[a-f0-9]{48}$/.test(inviteeUid || "")) return { rewarded: false, reason: "invalid_invitee" };
  const script = "local inviteeRaw=redis.call('GET',KEYS[1]); if not inviteeRaw then return -1 end; local okI,invitee=pcall(cjson.decode,inviteeRaw); if not okI or type(invitee)~='table' or invitee.uid~=ARGV[1] or invitee.email_verified~=true then return -1 end; local inviterUid=invitee.referred_by_uid; if type(inviterUid)~='string' or not string.match(inviterUid,'^[a-f0-9]+$') or #inviterUid~=48 or inviterUid==ARGV[1] then return 0 end; local inviterRaw=redis.call('GET',KEYS[2]); if not inviterRaw then return 0 end; local okR,inviter=pcall(cjson.decode,inviterRaw); if not okR or type(inviter)~='table' or inviter.uid~=inviterUid or inviter.email_verified~=true then return 0 end; if redis.call('EXISTS',KEYS[4])==1 then return 0 end; local count=tonumber(inviter.referral_successful_count or 0); if count>=tonumber(ARGV[4]) then redis.call('SET',KEYS[4],'cap'); return -2 end; local balance=redis.call('GET',KEYS[3]); if not balance then balance=ARGV[3]; redis.call('SET',KEYS[3],balance) end; local newBalance=redis.call('INCRBY',KEYS[3],ARGV[2]); inviter.referral_successful_count=count+1; inviter.referral_credits_earned=tonumber(inviter.referral_credits_earned or 0)+tonumber(ARGV[2]); redis.call('SET',KEYS[2],cjson.encode(inviter)); redis.call('SET',KEYS[4],'1'); return newBalance";
  const inviterRaw = await redis(["GET", "vy:user:account:" + inviteeUid]);
  if (!inviterRaw) return { rewarded: false, reason: "invitee_missing" };
  let inviterUid;
  try { inviterUid = JSON.parse(inviterRaw).referred_by_uid; } catch { return { rewarded: false, reason: "invalid_invitee" }; }
  if (typeof inviterUid !== "string" || !/^[a-f0-9]{48}$/.test(inviterUid) || inviterUid === inviteeUid) {
    return { rewarded: false, reason: "no_referrer" };
  }
  const result = Number(await redis([
    "EVAL", script, "4",
    "vy:user:account:" + inviteeUid,
    "vy:user:account:" + inviterUid,
    "vy:user:" + inviterUid + ":credits",
    "vy:referral:rewarded:" + inviteeUid,
    inviteeUid, String(REFERRAL_REWARD), String(INITIAL_CREDITS), String(REFERRAL_MAX_REWARDS)
  ]));
  if (result > 0) return { rewarded: true, credits_added: REFERRAL_REWARD, balance: result };
  return { rewarded: false, reason: result === -2 ? "referral_limit_reached" : "not_eligible" };
}

module.exports = { REFERRAL_REWARD, REFERRAL_MAX_REWARDS, getOrCreateReferralCode, applyReferralReward };
