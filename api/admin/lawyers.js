const crypto = require("crypto");
const { redis } = require("../../lib/quota");

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
async function audit(event) {
  try {
    await redis(["LPUSH", "vy:admin:audit", JSON.stringify(event)]);
    await redis(["LTRIM", "vy:admin:audit", "0", "499"]);
    return true;
  } catch (e) {
    console.error("Lawyer audit error:", e.message);
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
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || !safeEqual(req.headers.authorization?.replace(/^Bearer\s+/i, ""), adminKey)) {
    return res.status(401).json({ error: "دسترسی مدیر تأیید نشد." });
  }
  try {
    const action = req.body?.action;
    if (action === "list") {
      const ids = await redis(["SMEMBERS", "vy:lawyers:index"]) || [];
      const lawyers = await Promise.all(ids.map(async id => {
        const raw = await redis(["GET", `vy:lawyer:${id}`]);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
      }));
      return res.status(200).json({ ok: true, lawyers: lawyers.filter(Boolean) });
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
    if (action === "set_access") {
      const id = typeof req.body?.lawyer_id === "string" ? req.body.lawyer_id.trim() : "";
      const enabled = req.body?.enabled;
      if (!/^[a-f0-9]{32}$/.test(id) || typeof enabled !== "boolean") return res.status(400).json({ error: "شناسه و وضعیت دسترسی معتبر نیست." });
      const key = `vy:lawyer:${id}`;
      const raw = await redis(["GET", key]);
      if (!raw) return res.status(404).json({ error: "حساب وکیل یافت نشد." });
      let lawyer;
      try { lawyer = JSON.parse(raw); } catch {
        return res.status(500).json({ error: "اطلاعات این حساب وکیل در پایگاه داده مخدوش است؛ وضعیت تغییر نکرد." });
      }
      if (!lawyer || lawyer.id !== id) return res.status(500).json({ error: "ساختار اطلاعات حساب وکیل معتبر نیست." });
      lawyer.access = enabled ? "active" : "disabled";
      lawyer.access_updated_at = new Date().toISOString();
      await redis(["SET", key, JSON.stringify(lawyer)]);
      const audited = await audit({ action: enabled ? "lawyer_access_enabled" : "lawyer_access_disabled", lawyer_id: id, at: new Date().toISOString() });
      return res.status(200).json({ ok: true, lawyer, audit_warning: !audited, message: enabled ? "دسترسی وکیل فعال شد." : "دسترسی پاسخ‌گویی وکیل قطع شد." });
    }
    return res.status(400).json({ error: "عملیات شناخته‌شده نیست." });
  } catch (error) {
    console.error("Admin lawyer management error:", error.message);
    return res.status(503).json({ error: "عملیات انجام نشد؛ تنظیمات پایگاه داده را بررسی کنید." });
  }
};