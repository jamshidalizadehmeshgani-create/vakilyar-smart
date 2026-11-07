const crypto = require("crypto");
const { redis } = require("../../lib/quota");
const { authorizeAdmin } = require("../../lib/admin-auth");
const { sendWelcomeEmail } = require("../../lib/email");

async function audit(event) {
  try {
    await redis(["LPUSH", "vy:admin:audit", JSON.stringify(event)]);
    await redis(["LTRIM", "vy:admin:audit", "0", "499"]);
    return true;
  } catch (e) {
    console.error("Lawyer audit error:");
    return false;
  }
}
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "فقط درخواست POST پذیرفته می‌شود." });
  }
  if (!await authorizeAdmin(req, res)) return;
  try {
    const action = req.body?.action;
    if (action === "config") {
      const initialCredits = Number(process.env.FREE_CREDITS_INITIAL || 1000);
      let redisConnection = false;
      if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        try { redisConnection = (await redis(["PING"])) === "PONG"; } catch { redisConnection = false; }
      }
      const configuration = {
        admin_api_key_present: Boolean(process.env.ADMIN_API_KEY),
        admin_api_key_strength_ok: Boolean(process.env.ADMIN_API_KEY && process.env.ADMIN_API_KEY.length >= 32),
        app_secret_present: Boolean(process.env.APP_SECRET),
        app_secret_strength_ok: Boolean(process.env.APP_SECRET && process.env.APP_SECRET.length >= 32),
        upstash_url_present: Boolean(process.env.UPSTASH_REDIS_REST_URL),
        upstash_token_present: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
        redis_connection: redisConnection,
        ai_api_key_present: Boolean(process.env.AI_API_KEY || process.env.ai_api_key),
        free_credits_initial_valid: Number.isSafeInteger(initialCredits) && initialCredits >= 0 && initialCredits <= 10000000
      };
      return res.status(200).json({ ok: true, configuration });
    }
    if (action === "audit") {
      const rows = await redis(["LRANGE", "vy:admin:audit", "0", "99"]) || [];
      const events = rows.map(row => {
        try {
          const event = JSON.parse(row);
          if (!event || typeof event !== "object") return null;
          return {
            action: typeof event.action === "string" ? event.action.slice(0, 80) : "unknown",
            user_id: typeof event.user_id === "string" ? event.user_id : null,
            lawyer_id: typeof event.lawyer_id === "string" ? event.lawyer_id : null,
            amount: Number.isSafeInteger(event.amount) ? event.amount : null,
            at: typeof event.at === "string" ? event.at : null
          };
        } catch { return null; }
      }).filter(Boolean);
      return res.status(200).json({ ok: true, events });
    }
    if (action === "list") {
      const ids = await redis(["SMEMBERS", "vy:lawyers:index"]) || [];
      const lawyers = await Promise.all(ids.map(async id => {
        const raw = await redis(["GET", `vy:lawyer:${id}`]);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
      }));
      const safeLawyers = lawyers.filter(Boolean).map(({ password_hash, ...lawyer }) => lawyer);
      return res.status(200).json({ ok: true, lawyers: safeLawyers });
    }
    if (action === "create") {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const license = typeof req.body?.license_number === "string" ? req.body.license_number.trim() : "";
      if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "نام و نام خانوادگی وکیل را وارد کنید." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) return res.status(400).json({ error: "ایمیل معتبر وارد کنید." });
      if (license.length > 80) return res.status(400).json({ error: "شماره پروانه بیش از حد طولانی است." });
      const id = crypto.randomBytes(16).toString("hex");
      const lawyer = { id, name, email, license_number: license, access: "disabled", created_at: new Date().toISOString() };
      const emailKey = "vy:lawyer:email:" + crypto.createHash("sha256").update(email).digest("hex");
      const createScript = "if redis.call('EXISTS',KEYS[1])==1 then return 0 end; redis.call('SET',KEYS[1],ARGV[1]); redis.call('SET',KEYS[2],ARGV[2]); redis.call('SADD',KEYS[3],ARGV[1]); return 1";
      const created = Number(await redis(["EVAL", createScript, "3", emailKey, `vy:lawyer:${id}`, "vy:lawyers:index", id, JSON.stringify(lawyer)]));
      if (created !== 1) return res.status(409).json({ error: "برای این ایمیل قبلاً حساب وکیل ثبت شده است." });
      const audited = await audit({ action: "lawyer_created", lawyer_id: id, at: new Date().toISOString() });
      return res.status(201).json({ ok: true, lawyer, audit_warning: !audited, message: "پرونده وکیل ایجاد شد؛ دسترسی پاسخ‌گویی به‌صورت پیش‌فرض غیرفعال است." });
    }
    if (action === "set_password") {
      const id = typeof req.body?.lawyer_id === "string" ? req.body.lawyer_id.trim() : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!/^[a-f0-9]{32}$/.test(id) || password.length < 12 || password.length > 200) {
        return res.status(400).json({ error: "شناسه معتبر و رمز حداقل ۱۲ کاراکتری لازم است." });
      }
      const key = `vy:lawyer:${id}`;
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, keyBytes) => err ? reject(err) : resolve(keyBytes.toString("hex"))));
      const passwordHash = salt + ":" + hash;
      const updatedAt = new Date().toISOString();
      const updatePasswordScript = "local raw=redis.call('GET',KEYS[1]); if not raw then return -1 end; local ok,lawyer=pcall(cjson.decode,raw); if not ok or type(lawyer)~='table' or lawyer.id~=ARGV[1] then return -2 end; local sessions=redis.call('SMEMBERS',KEYS[2]); for _,sessionKey in ipairs(sessions) do redis.call('DEL',sessionKey) end; redis.call('DEL',KEYS[2]); lawyer.password_hash=ARGV[2]; lawyer.session_version=(tonumber(lawyer.session_version) or 0)+1; lawyer.password_updated_at=ARGV[3]; redis.call('SET',KEYS[1],cjson.encode(lawyer)); return 1";
      const updated = Number(await redis(["EVAL", updatePasswordScript, "2", key, "vy:lawyer:" + id + ":sessions", id, passwordHash, updatedAt]));
      if (updated === -1) return res.status(404).json({ error: "حساب وکیل یافت نشد." });
      if (updated !== 1) return res.status(500).json({ error: "ساختار حساب معتبر نیست؛ رمز تغییر نکرد." });
      const audited = await audit({ action: "lawyer_password_set", lawyer_id: id, at: new Date().toISOString() });
      return res.status(200).json({ ok: true, audit_warning: !audited, message: "رمز ورود به‌صورت امن ثبت شد. آن را فقط از مسیر امن به وکیل تحویل دهید." });
    }
    if (action === "set_access") {
      const id = typeof req.body?.lawyer_id === "string" ? req.body.lawyer_id.trim() : "";
      const enabled = req.body?.enabled;
      if (!/^[a-f0-9]{32}$/.test(id) || typeof enabled !== "boolean") return res.status(400).json({ error: "شناسه و وضعیت دسترسی معتبر نیست." });
      const key = `vy:lawyer:${id}`;
      const updatedAt = new Date().toISOString();
      const access = enabled ? "active" : "disabled";
      const updateAccessScript = "local raw=redis.call('GET',KEYS[1]); if not raw then return -1 end; local ok,lawyer=pcall(cjson.decode,raw); if not ok or type(lawyer)~='table' or lawyer.id~=ARGV[1] then return -2 end; lawyer.access=ARGV[2]; if ARGV[2]=='disabled' then lawyer.session_version=(tonumber(lawyer.session_version) or 0)+1; local sessions=redis.call('SMEMBERS',KEYS[2]); for _,sessionKey in ipairs(sessions) do redis.call('DEL',sessionKey) end; redis.call('DEL',KEYS[2]); end; lawyer.access_updated_at=ARGV[3]; redis.call('SET',KEYS[1],cjson.encode(lawyer)); return 1";
      const updated = Number(await redis(["EVAL", updateAccessScript, "2", key, "vy:lawyer:" + id + ":sessions", id, access, updatedAt]));
      if (updated === -1) return res.status(404).json({ error: "حساب وکیل یافت نشد." });
      if (updated !== 1) return res.status(500).json({ error: "ساختار اطلاعات حساب وکیل معتبر نیست؛ وضعیت تغییر نکرد." });
      const updatedRaw = await redis(["GET", key]);
      const lawyer = JSON.parse(updatedRaw);
      let welcomeEmail = { sent: false, reason: "not_applicable" };
      if (enabled && lawyer.password_hash) {
        const welcomeKey = "vy:lawyer:" + id + ":welcome-email";
        const claimed = await redis(["SET", welcomeKey, "sending", "NX", "EX", "120"]);
        if (claimed === "OK") {
          welcomeEmail = await sendWelcomeEmail({
            to: lawyer.email,
            name: lawyer.name,
            role: "وکیل همکار",
            loginUrl: (process.env.APP_BASE_URL || "https://vakilyar-smart.vercel.app").replace(/\\/$/, "") + "/lawyer-login.html",
            details: [
              ["نام و نام خانوادگی", lawyer.name],
              ["ایمیل حساب", lawyer.email],
              ["شماره پروانه", lawyer.license_number || "ثبت نشده"],
              ["نوع حساب", "پنل اختصاصی وکیل"]
            ],
            features: [
              "ورود امن به پنل اختصاصی وکیل",
              "مشاهده پرسش‌های ارجاع‌شده",
              "ارسال پاسخ و پیگیری گفت‌وگو با کاربران"
            ]
          });
          if (welcomeEmail.sent) await redis(["SET", welcomeKey, "sent", "EX", "315360000"]);
          else await redis(["DEL", welcomeKey]);
        } else {
          const existingWelcomeState = await redis(["GET", welcomeKey]);
          welcomeEmail = { sent: existingWelcomeState === "sent", reason: existingWelcomeState === "sent" ? "already_sent" : "in_progress" };
        }
      }
      const audited = await audit({ action: enabled ? "lawyer_access_enabled" : "lawyer_access_disabled", lawyer_id: id, at: updatedAt });
      const { password_hash, ...safeLawyer } = lawyer;
      return res.status(200).json({
        ok: true, lawyer: safeLawyer, audit_warning: !audited,
        welcome_email_sent: welcomeEmail.sent,
        welcome_email_reason: welcomeEmail.reason,
        message: enabled
          ? (welcomeEmail.sent ? "دسترسی وکیل فعال شد و ایمیل خوشامدگویی ارسال شد." : "دسترسی وکیل فعال شد؛ ارسال ایمیل خوشامدگویی هنوز انجام نشده است.")
          : "دسترسی پاسخ‌گویی وکیل قطع شد."
      });
    }
    return res.status(400).json({ error: "عملیات شناخته‌شده نیست." });
  } catch (error) {
    console.error("Admin lawyer management error:");
    return res.status(503).json({ error: "عملیات انجام نشد؛ تنظیمات پایگاه داده را بررسی کنید." });
  }
};