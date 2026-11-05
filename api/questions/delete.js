const { getAccount, redis } = require("../../lib/quota");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "فقط POST مجاز است." });
  }

  const host = req.headers.host || "";
  let originHost = "";
  try { originHost = new URL(req.headers.origin || "").host; } catch {}
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (!host || !originHost || originHost !== host || (fetchSite && fetchSite !== "same-origin")) {
    return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  }

  const id = typeof req.body?.question_id === "string" ? req.body.question_id.trim() : "";
  if (!/^[a-f0-9]{32}$/.test(id)) {
    return res.status(400).json({ error: "شناسه پرسش معتبر نیست." });
  }

  try {
    const account = await getAccount(req, res);
    const script = [
      "local raw=redis.call('GET',KEYS[1])",
      "if not raw then return -1 end",
      "local ok,q=pcall(cjson.decode,raw)",
      "if not ok or type(q)~='table' then return -2 end",
      "if q.user_id~=ARGV[1] then return -3 end",
      "redis.call('DEL',KEYS[1])",
      "redis.call('LREM',KEYS[2],0,ARGV[2])",
      "redis.call('LREM',KEYS[3],0,ARGV[2])",
      "return 1"
    ].join("; ");
    const result = Number(await redis([
      "EVAL", script, "3",
      "vy:question:" + id,
      "vy:user:" + account.uid + ":questions",
      "vy:lawyer:" + (typeof req.body?.lawyer_id === "string" && /^[a-f0-9]{32}$/.test(req.body.lawyer_id) ? req.body.lawyer_id : "invalid") + ":questions",
      account.uid, id
    ]));
    if (result === -1) return res.status(404).json({ error: "پرسش یافت نشد یا قبلاً حذف شده است." });
    if (result === -3) return res.status(403).json({ error: "اجازه حذف این پرسش را ندارید." });
    if (result !== 1) return res.status(503).json({ error: "حذف پرسش انجام نشد." });
    return res.status(200).json({ ok: true, message: "پرسش و پاسخ‌های وابسته از پرونده شما حذف شد." });
  } catch (error) {
    console.error("Question delete error:", error.message);
    return res.status(503).json({ error: "حذف پرسش موقتاً ممکن نیست." });
  }
};
