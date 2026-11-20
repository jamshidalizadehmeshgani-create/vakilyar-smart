const crypto = require("crypto");
const { redis } = require("../../lib/quota");
const { authorizeAdmin } = require("../../lib/admin-auth");

const MEMORY_KEY = "vy:admin:owner-memory";
const MAX_RECORDS = 200;

function safeRecord(raw) {
  try {
    const item = JSON.parse(raw);
    if (!item || typeof item !== "object" || !/^[a-f0-9]{32}$/.test(item.id || "")) return null;
    return {
      id: item.id,
      title: String(item.title || "").slice(0, 120),
      content: String(item.content || "").slice(0, 4000),
      category: String(item.category || "یادداشت مالک").slice(0, 40),
      created_at: typeof item.created_at === "string" ? item.created_at : null,
      updated_at: typeof item.updated_at === "string" ? item.updated_at : null
    };
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "فقط درخواست POST پذیرفته می‌شود." });
  }
  if (!await authorizeAdmin(req, res)) return;

  const action = req.body?.action;
  try {
    if (action === "list") {
      const rows = await redis(["LRANGE", MEMORY_KEY, "0", String(MAX_RECORDS - 1)]) || [];
      const records = rows.map(safeRecord).filter(Boolean);
      return res.status(200).json({ ok: true, count: records.length, records });
    }
    if (action === "add") {
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
      const category = typeof req.body?.category === "string" ? req.body.category.trim() : "یادداشت مالک";
      if (!title || title.length > 120) return res.status(400).json({ error: "عنوان یادداشت باید بین ۱ تا ۱۲۰ نویسه باشد." });
      if (!content || content.length > 4000) return res.status(400).json({ error: "متن یادداشت باید بین ۱ تا ۴۰۰۰ نویسه باشد." });
      if (category.length > 40) return res.status(400).json({ error: "دسته‌بندی بیش از حد طولانی است." });
      const now = new Date().toISOString();
      const record = { id: crypto.randomBytes(16).toString("hex"), title, content, category: category || "یادداشت مالک", created_at: now, updated_at: now };
      await redis(["LPUSH", MEMORY_KEY, JSON.stringify(record)]);
      await redis(["LTRIM", MEMORY_KEY, "0", String(MAX_RECORDS - 1)]);
      await redis(["LPUSH", "vy:admin:audit", JSON.stringify({ action: "owner_memory_added", at: now, memory_id: record.id })]);
      await redis(["LTRIM", "vy:admin:audit", "0", "499"]);
      return res.status(201).json({ ok: true, record, message: "یادداشت در حافظه خصوصی مالک ذخیره شد." });
    }
    if (action === "delete") {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: "شناسه یادداشت معتبر نیست." });
      const rows = await redis(["LRANGE", MEMORY_KEY, "0", String(MAX_RECORDS - 1)]) || [];
      const target = rows.map(safeRecord).find(item => item && item.id === id);
      if (!target) return res.status(404).json({ error: "یادداشت پیدا نشد." });
      const script = "local rows=redis.call('LRANGE',KEYS[1],0,199); local removed=0; for _,raw in ipairs(rows) do local ok,item=pcall(cjson.decode,raw); if ok and item.id==ARGV[1] then redis.call('LREM',KEYS[1],1,raw); removed=1; break end end; return removed";
      const removed = Number(await redis(["EVAL", script, "1", MEMORY_KEY, id]));
      if (removed !== 1) return res.status(404).json({ error: "یادداشت پیدا نشد." });
      const now = new Date().toISOString();
      await redis(["LPUSH", "vy:admin:audit", JSON.stringify({ action: "owner_memory_deleted", at: now, memory_id: id })]);
      await redis(["LTRIM", "vy:admin:audit", "0", "499"]);
      return res.status(200).json({ ok: true, message: "یادداشت از حافظه خصوصی مالک حذف شد." });
    }
    return res.status(400).json({ error: "عملیات حافظه معتبر نیست." });
  } catch {
    console.error("Owner memory operation failed");
    return res.status(503).json({ error: "حافظه خصوصی مالک موقتاً در دسترس نیست؛ اتصال پایگاه داده را بررسی کنید." });
  }
};
