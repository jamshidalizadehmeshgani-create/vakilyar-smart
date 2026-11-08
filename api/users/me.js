const { getUserSessionUid, redis } = require("../../lib/user-auth");
const { getOrCreateReferralCode, REFERRAL_REWARD, REFERRAL_MAX_REWARDS } = require("../../lib/referrals");
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "فقط GET مجاز است." }); }
  try {
    const uid = await getUserSessionUid(req);
    if (!uid) return res.status(401).json({ authenticated: false });
    const raw = await redis(["GET", "vy:user:account:" + uid]);
    if (!raw) return res.status(401).json({ authenticated: false });
    const account = JSON.parse(raw);
    if (!account || account.uid !== uid || account.email_verified !== true) return res.status(401).json({ authenticated: false });
    const referralCode = await getOrCreateReferralCode(uid);
    const base = String(process.env.APP_BASE_URL || "https://vakilyar-smart.vercel.app").replace(/\/$/, "");
    const referralUrl = base + "/user-register.html?ref=" + encodeURIComponent(referralCode);
    return res.status(200).json({
      authenticated: true,
      profile: {
        first_name: account.first_name, last_name: account.last_name, email: account.email,
        email_verified: true, created_at: account.created_at,
        referral_code: referralCode, referral_url: referralUrl,
        successful_referrals: Number(account.referral_successful_count || 0),
        referral_credits_earned: Number(account.referral_credits_earned || 0),
        referral_reward_per_signup: REFERRAL_REWARD,
        referral_max_rewards: REFERRAL_MAX_REWARDS
      }
    });
  } catch {
    console.error("Public user profile lookup failed");
    return res.status(503).json({ error: "دریافت مشخصات حساب موقتاً ممکن نیست." });
  }
};
