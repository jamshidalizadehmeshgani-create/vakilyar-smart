const { redis } = require("../../lib/quota");
const { authorizeAdmin } = require("../../lib/admin-auth");

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
    if (action === "list") {
      const ids = await redis(["LRANGE", "vy:support:inbox", "0", "99"]) || [];
      const rows = await Promise.all(ids.map(async id => {
        const raw = await redis(["GET", `vy:support:case:${id}`]);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
      }));
      return res.status(200).json({ ok: true, cases: rows.filter(Boolean) });
    }
    if (action === "review") {
      const id = typeof req.body?.case_id === "string" ? req.body.case_id : "";
      const decision = req.body?.decision;
      const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 1000) : "";
      if (!/^[a-f0-9]{32}$/.test(id) || !["reopen", "reject", "suspend"].includes(decision)) {
        return res.status(400).json({ error: "شناسه درخواست یا تصمیم مدیر معتبر نیست." });
      }
      const now = new Date().toISOString();
      const script = "local raw=redis.call('GET',KEYS[1]); if not raw then return -1 end; local ok,item=pcall(cjson.decode,raw); if not ok or type(item)~='table' or not string.match(item.user_id or '', '^[a-f0-9]+$') or string.len(item.user_id)~=48 then return -2 end; if item.status~='pending' then return -3 end; local statusKey='vy:user:'..item.user_id..':status'; if ARGV[1]=='reopen' then redis.call('DEL',statusKey); item.status='approved_reopened'; elseif ARGV[1]=='suspend' then redis.call('SET',statusKey,'suspended'); item.status='approved_suspended'; else item.status='rejected'; end; item.admin_note=ARGV[2]; item.reviewed_at=ARGV[3]; item.updated_at=ARGV[3]; redis.call('SET',KEYS[1],cjson.encode(item),'EX',ARGV[4]); redis.call('LPUSH',KEYS[2],ARGV[5]); redis.call('LTRIM',KEYS[2],'0','499'); return 1";
      const audit = JSON.stringify({ action: "support_" + decision, case_id: id, at: now });
      const result = Number(await redis(["EVAL", script, "2", `vy:support:case:${id}`, "vy:admin:audit", decision, note, now, "7776000", audit]));
      if (result === -1) return res.status(404).json({ error: "درخواست پشتیبانی پیدا نشد." });
      if (result === -2) return res.status(409).json({ error: "اطلاعات درخواست معتبر نیست؛ هیچ تغییری انجام نشد." });
      if (result === -3) return res.status(409).json({ error: "این درخواست قبلاً بررسی شده است." });
      return res.status(200).json({ ok: true, message: decision === "reopen" ? "دسترسی حساب با تأیید مدیر بازگشایی شد." : decision === "suspend" ? "دسترسی حساب با تصمیم مدیر متوقف شد." : "درخواست رد شد؛ دسترسی حساب تغییر نکرد." });
    }
    return res.status(400).json({ error: "عملیات شناخته‌شده نیست." });
  } catch {
    console.error("Admin support case error:");
    return res.status(503).json({ error: "بررسی درخواست انجام نشد؛ پایگاه داده را بررسی کنید." });
  }
};
