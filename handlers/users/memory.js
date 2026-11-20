const crypto = require("crypto");
const { getUserSessionUid, sameOrigin } = require("../../lib/user-auth");
const { redis, consumeAccountRateLimit } = require("../../lib/quota");

const MAX_RECORDS = 100;
const MEMORY_PREFIX = "vy:user:";
function safeRecord(raw) {
  try {
    const item = JSON.parse(raw);
    if (!item || typeof item !== "object" || !/^[a-f0-9]{32}$/.test(item.id || "")) return null;
    return {
      id: item.id,
      title: String(item.title || "").slice(0, 120),
      content: String(item.content || "").slice(0, 4000),
      category: String(item.category || "یادداشت شخصی").slice(0, 40),
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
  if (!sameOrigin(req)) return res.status(403).json({ error: "مبدأ درخواست معتبر نیست." });
  try {
    const uid = await getUserSessionUid(req);
    if (!/^[a-f0-9]{48}$/.test(uid || "")) return res.status(401).json({ error: "برای دسترسی به حافظه شخصی ابتدا وارد حساب شوید." });
    const limit = await consumeAccountRateLimit(uid, { scope: "user-memory", limit: 60, windowSeconds: 3600 });
    if (limit.count > limit.limit) {
      res.setHeader("Retry-After", String(limit.windowSeconds));
      return res.status(429).json({ error: "تعداد درخواست‌های حافظه شخصی بیش از حد مجاز است." });
    }
    const key = MEMORY_PREFIX + uid + ":memory";
    const action = req.body?.action;
    if (action === "list") {
      const rows = await redis(["LRANGE", key, "0", String(MAX_RECORDS - 1)]) || [];
      const records = rows.map(safeRecord).filter(Boolean);
      return res.status(200).json({ ok: true, count: records.length, records });
    }
    if (action === "add") {
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
      const category = typeof req.body?.category === "string" ? req.body.category.trim() : "یادداشت شخصی";
      if (!title || title.length > 120) return res.status(400).json({ error: "عنوان باید بین ۱ تا ۱۲۰ نویسه باشد." });
      if (!content || content.length > 4000) return res.status(400).json({ error: "متن یادداشت باید بین ۱ تا ۴۰۰۰ نویسه باشد." });
      if (category.length > 40) return res.status(400).json({ error: "دسته‌بندی بیش از حد طولانی است." });
      const now = new Date().toISOString();
      const record = { id: crypto.randomBytes(16).toString("hex"), title, content, category: category || "یادداشت شخصی", created_at: now, updated_at: now };
      await redis(["LPUSH", key, JSON.stringify(record)]);
      await redis(["LTRIM", key, "0", String(MAX_RECORDS - 1)]);
      return res.status(201).json({ ok: true, record, message: "یادداشت در حافظه خصوصی حساب شما ذخیره شد." });
    }
    if (action === "update") {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
      const category = typeof req.body?.category === "string" ? req.body.category.trim() : "یادداشت شخصی";
      if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: "شناسه یادداشت معتبر نیست." });
      if (!title || title.length > 120 || !content || content.length > 4000 || category.length > 40) {
        return res.status(400).json({ error: "عنوان، متن یا دسته‌بندی معتبر نیست." });
      }
      const now = new Date().toISOString();
      const replacement = JSON.stringify({ id, title, content, category: category || "یادداشت شخصی", updated_at: now });
      const script = "local rows=redis.call('LRANGE',KEYS[1],0,99); for i,raw in ipairs(rows) do local ok,item=pcall(cjson.decode,raw); if ok and item.id==ARGV[1] then local record=cjson.decode(ARGV[2]); record.created_at=item.created_at; redis.call('LSET',KEYS[1],i-1,cjson.encode(record)); return 1 end end; return 0";
      const changed = Number(await redis(["EVAL", script, "1", key, id, replacement]));
      if (changed !== 1) return res.status(404).json({ error: "یادداشت در حافظه همین حساب پیدا نشد." });
      return res.status(200).json({ ok: true, message: "یادداشت به‌روزرسانی شد." });
    }
    if (action === "delete") {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: "شناسه یادداشت معتبر نیست." });
      const script = "local rows=redis.call('LRANGE',KEYS[1],0,99); for _,raw in ipairs(rows) do local ok,item=pcall(cjson.decode,raw); if ok and item.id==ARGV[1] then redis.call('LREM',KEYS[1],1,raw); return 1 end end; return 0";
      const removed = Number(await redis(["EVAL", script, "1", key, id]));
      if (removed !== 1) return res.status(404).json({ error: "یادداشت در حافظه همین حساب پیدا نشد." });
      return res.status(200).json({ ok: true, message: "یادداشت حذف شد." });
    }
    return res.status(400).json({ error: "عملیات حافظه معتبر نیست." });
  } catch {
    console.error("Private user memory operation failed");
    return res.status(503).json({ error: "حافظه شخصی موقتاً در دسترس نیست؛ اتصال پایگاه داده را بررسی کنید." });
  }
};
