const crypto = require("crypto");
const { redis, consumeIpRateLimit } = require("../../lib/quota");
const { sendLawyerVerificationEmail } = require("../../lib/email");
const { sameOrigin } = require("../../lib/user-auth");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "فقط POST مجاز است." }); }
  if (!sameOrigin(req)) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    const rate = await consumeIpRateLimit(req, { scope: "lawyer-resend-verify", limit: 3, windowSeconds: 3600 });
    if (rate.count > rate.limit) return res.status(429).json({ error: "تعداد درخواست‌های ارسال مجدد بیش از حد مجاز است." });
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 190) {
      return res.status(400).json({ error: "ایمیل معتبر وارد کنید." });
    }
    const emailHash = crypto.createHash("sha256").update(email).digest("hex");
    const id = await redis(["GET", "vy:lawyer:email:" + emailHash]);
    if (typeof id === "string" && /^[a-f0-9]{32}$/.test(id)) {
      const lawyerKey = "vy:lawyer:" + id;
      const raw = await redis(["GET", lawyerKey]);
      if (raw) {
        const lawyer = JSON.parse(raw);
        if (lawyer && lawyer.id === id && lawyer.email_verified === false) {
          const token = crypto.randomBytes(32).toString("hex");
          const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
          const tokenKey = "vy:lawyer:verify:" + tokenHash;
          const pointerKey = lawyerKey + ":verify-token";
          const script = "local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end; local ok,lawyer=pcall(cjson.decode,raw); if not ok or type(lawyer)~='table' or lawyer.id~=ARGV[1] or lawyer.email_verified~=false then return 0 end; local old=redis.call('GET',KEYS[2]); if old then redis.call('DEL','vy:lawyer:verify:'..old) end; lawyer.email_verification_created_at=ARGV[4]; redis.call('SET',KEYS[1],cjson.encode(lawyer)); redis.call('SET',KEYS[3],ARGV[1],'EX',ARGV[3]); redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3]); return 1";
          const issued = Number(await redis(["EVAL", script, "3", lawyerKey, pointerKey, tokenKey, id, tokenHash, "86400", new Date().toISOString()]));
          if (issued === 1) {
            await sendLawyerVerificationEmail({ to: lawyer.email, name: lawyer.name, token });
          }
        }
      }
    }
    return res.status(200).json({
      ok: true,
      message: "اگر پرونده تأییدنشده‌ای با این ایمیل وجود داشته باشد، پیوند تازه‌ای برای آن ارسال خواهد شد."
    });
  } catch {
    console.error("Lawyer verification resend failed");
    return res.status(503).json({ error: "ارسال پیوند تأیید موقتاً ممکن نیست." });
  }
};
