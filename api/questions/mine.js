const { getAccount, redis } = require("../../lib/quota");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "فقط GET و POST مجاز است." });
  }

  try {
    const account = await getAccount(req, res);

    if (req.method === "POST") {
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

      const questionKey = "vy:question:" + id;
      const raw = await redis(["GET", questionKey]);
      if (!raw) return res.status(404).json({ error: "پرسش یافت نشد یا قبلاً حذف شده است." });

      let question;
      try { question = JSON.parse(raw); } catch {
        return res.status(503).json({ error: "اطلاعات پرسش قابل خواندن نیست." });
      }
      if (!question || question.user_id !== account.uid) {
        return res.status(403).json({ error: "اجازه حذف این پرسش را ندارید." });
      }

      await redis(["DEL", questionKey]);
      await redis(["LREM", "vy:user:" + account.uid + ":questions", "0", id]);
      if (typeof question.lawyer_id === "string" && /^[a-f0-9]{32}$/.test(question.lawyer_id)) {
        await redis(["LREM", "vy:lawyer:" + question.lawyer_id + ":questions", "0", id]);
      }
      return res.status(200).json({ ok: true, message: "پرسش و پاسخ‌های وابسته از پرونده شما حذف شد." });
    }

    const ids = await redis(["LRANGE", "vy:user:" + account.uid + ":questions", "0", "99"]) || [];
    const questions = await Promise.all(ids.map(async id => {
      const raw = await redis(["GET", "vy:question:" + id]);
      if (!raw) return null;
      try {
        const q = JSON.parse(raw);
        if (!q || q.user_id !== account.uid) return null;
        return { id: q.id, lawyer_name: q.lawyer_name, question: q.question, status: q.status, created_at: q.created_at, updated_at: q.updated_at || null, replies: Array.isArray(q.replies) ? q.replies.map(a => ({ lawyer_name: a.lawyer_name, message: a.message, created_at: a.created_at })) : [] };
      } catch { return null; }
    }));
    return res.status(200).json({ ok: true, questions: questions.filter(Boolean) });
  } catch (e) {
    console.error("User questions error:", e.message);
    return res.status(503).json({ error: "عملیات پرسش‌ها موقتاً ممکن نیست." });
  }
};
