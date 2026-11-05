const { getAccount } = require("../lib/quota");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "فقط درخواست GET پذیرفته می‌شود." });
  }
  try {
    const account = await getAccount(req, res);
    return res.status(200).json({
      ok: true,
      account_id: account.uid,
      plan: account.isPro ? "pro" : "free",
      legal_scope_default: "iran",
      credits_remaining: (account.isPro || account.isUnlimited) ? null : account.credits,
      unlimited: account.isUnlimited,
      free_credits_initial: Number(process.env.FREE_CREDITS_INITIAL || 1000)
    });
  } catch (error) {
    console.error("Usage API error:", error.message);
    return res.status(503).json({
      ok: false,
      error: "سامانه سهمیه هنوز پیکربندی نشده است."
    });
  }
};
