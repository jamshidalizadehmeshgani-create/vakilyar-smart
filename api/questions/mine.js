const { getAccount, redis } = require("../../lib/quota");

const DELETE_OWNED_QUESTION_SCRIPT = `
-- DELETE_OWNED_QUESTION
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, question = pcall(cjson.decode, raw)
if not ok or type(question) ~= "table" or question.user_id ~= ARGV[1] then
  return -1
end
redis.call("DEL", KEYS[1])
redis.call("LREM", KEYS[2], 0, ARGV[2])
if ARGV[3] == "1" then
  redis.call("LREM", KEYS[3], 0, ARGV[2])
end
return 1
`;

async function pruneQuestionIndex(listKey, staleIds) {
  const ids = [...new Set((Array.isArray(staleIds) ? staleIds : []).filter(id => typeof id === "string" && /^[a-f0-9]{32}$/.test(id)))];
  if (!listKey || ids.length === 0) return 0;
  const results = await Promise.all(ids.map(id => redis(["LREM", listKey, "0", id])));
  return results.reduce((sum, count) => sum + Number(count || 0), 0);
}

async function deleteOwnedQuestion({ questionKey, userListKey, lawyerListKey, userId, questionId, removeLawyer }) {
  const result = await redis([
    "EVAL",
    DELETE_OWNED_QUESTION_SCRIPT,
    "3",
    questionKey,
    userListKey,
    lawyerListKey || "",
    userId,
    questionId,
    removeLawyer ? "1" : "0"
  ]);
  return Number(result);
}

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

      const hasLawyer = typeof question.lawyer_id === "string" && /^[a-f0-9]{32}$/.test(question.lawyer_id);
      const deleted = await deleteOwnedQuestion({
        questionKey,
        userListKey: "vy:user:" + account.uid + ":questions",
        lawyerListKey: hasLawyer ? "vy:lawyer:" + question.lawyer_id + ":questions" : "",
        userId: account.uid,
        questionId: id,
        removeLawyer: hasLawyer
      });
      if (deleted === 0) return res.status(404).json({ error: "پرسش یافت نشد یا قبلاً حذف شده است." });
      if (deleted === -1) return res.status(403).json({ error: "اجازه حذف این پرسش را ندارید." });
      if (deleted !== 1) throw new Error("Unexpected atomic question deletion result");
      return res.status(200).json({ ok: true, message: "پرسش و پاسخ‌های وابسته از پرونده شما حذف شد." });
    }

    const ids = await redis(["LRANGE", "vy:user:" + account.uid + ":questions", "0", "99"]) || [];
    const checked = await Promise.all(ids.map(async id => {
      if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) return { id, question: null };
      const raw = await redis(["GET", "vy:question:" + id]);
      if (!raw) return { id, question: null };
      try {
        const q = JSON.parse(raw);
        if (!q || q.user_id !== account.uid) return { id, question: null };
        return { id, question: { id: q.id, lawyer_name: q.lawyer_name, question: q.question, status: q.status, created_at: q.created_at, updated_at: q.updated_at || null, replies: Array.isArray(q.replies) ? q.replies.map(a => ({ lawyer_name: a.lawyer_name, message: a.message, created_at: a.created_at })) : [] } };
      } catch { return { id, question: null }; }
    }));
    const staleIds = checked.filter(item => !item.question).map(item => item.id);
    await pruneQuestionIndex("vy:user:" + account.uid + ":questions", staleIds);
    return res.status(200).json({ ok: true, questions: checked.map(item => item.question).filter(Boolean) });
  } catch (e) {
    console.error("User questions error:", e.message);
    return res.status(503).json({ error: "عملیات پرسش‌ها موقتاً ممکن نیست." });
  }
};

module.exports.deleteOwnedQuestion = deleteOwnedQuestion;
module.exports.pruneQuestionIndex = pruneQuestionIndex;
