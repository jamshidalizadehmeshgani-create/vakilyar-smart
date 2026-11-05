const { getAccount, classifyRequest, consume, refund } = require("../lib/quota");

const SYSTEM_PROMPT = `تو وکیل‌یار هستی؛ دستیار ارائه‌دهنده اطلاعات عمومی حقوقی به زبان فارسی.
با زبان روشن، محترمانه و مرحله‌به‌مرحله پاسخ بده.
حوزه پیش‌فرض و نسخه رایگان فقط قوانین جمهوری اسلامی ایران است. حقوق بین‌الملل و قوانین کشورهای دیگر فقط برای کاربر پرو و با انتخاب صریح حوزه مربوط مجاز است. حقوق بین‌الملل را قانون واحد تلقی نکن.
اطلاعات عمومی را از مشاوره تخصصی وکیل متمایز کن.
هرگز ماده قانونی، رأی، شماره پرونده، منبع یا نقل‌قول را جعل نکن.
اگر از اعتبار یا به‌روز بودن حکم مطمئن نیستی، صریح بگو و کاربر را به بررسی متن رسمی قانون یا وکیل دارای پروانه ارجاع بده.
برای تصمیم‌های مهم، مهلت‌های قانونی، دعاوی جاری و موضوعات وابسته به جزئیات پرونده توصیه کن با وکیل مشورت شود.
اطلاعات هویتی، شماره ملی، رمز یا جزئیات محرمانه غیرضروری درخواست نکن.`;

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "فقط درخواست POST پذیرفته می‌شود." });
  }

  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "لطفاً پرسش خود را وارد کنید." });
  if (message.length > 6000) return res.status(413).json({ error: "متن پرسش بیش از حد طولانی است." });

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      configured: false,
      reply: "نسخه آزمایشی وکیل‌یار فعال است، اما موتور هوش مصنوعی هنوز پیکربندی نشده است. پس از افزودن کلید API معتبر در تنظیمات امن سرور، پاسخ‌گویی هوشمند فعال می‌شود. لطفاً فعلاً این پیام را به‌عنوان تأیید عملکرد رابط کاربری در نظر بگیرید."
    });
  }

  let account;
  let charged = 0;
  let remainingCredits = null;
  const endpoint = process.env.AI_API_URL || "https://api.groq.com/openai/v1/chat/completions";
  const model = process.env.AI_MODEL || "openai/gpt-oss-20b";

  try {
    account = await getAccount(req, res);
    const requestedScope = req.body?.legal_scope;
    const foreignRequest = requestedScope === "international" || requestedScope === "country" ||
      /حقوق بین.?الملل|قوانین آلمان|قانون آلمان|قوانین آمریکا|قانون آمریکا|قوانین انگلستان|قانون انگلستان|قوانین فرانسه|قانون فرانسه|قوانین ترکیه|قانون ترکیه/i.test(message);
    if (foreignRequest && !account.isPro) {
      return res.status(403).json({ code: "PRO_REQUIRED", error: "بررسی حقوق بین‌الملل و قوانین سایر کشورها در وکیل‌یار پرو ارائه می‌شود." });
    }
    if (!account.isPro) {
      charged = classifyRequest(message);
      remainingCredits = await consume(account.key, charged);
      if (remainingCredits < 0) return res.status(402).json({ code: "CREDITS_EXHAUSTED", error: "اعتبار رایگان شما به پایان رسیده است. برای ادامه، وکیل‌یار پرو را فعال کنید." });
    }
    const scopeLabel = foreignRequest ? (req.body?.country || "حوزه حقوقی انتخاب‌شده") : "قوانین جمهوری اسلامی ایران";
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + "\nحوزه حقوقی این درخواست: " + scopeLabel },
          { role: "user", content: message }
        ]
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("AI provider error:", upstream.status, data?.error?.message || "unknown");
      if (charged) await refund(account.key, charged);
      return res.status(502).json({ error: "ارتباط با موتور هوش مصنوعی برقرار نشد؛ اعتبار رزروشده بازگردانده شد." });
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) { if (charged) await refund(account.key, charged); return res.status(502).json({ error: "پاسخ معتبری دریافت نشد؛ اعتبار رزروشده بازگردانده شد." }); }
    return res.status(200).json({ configured: true, reply, plan: account.isPro ? "pro" : "free", credits_used: charged, credits_remaining: account.isPro ? null : remainingCredits });
  } catch (error) {
    if (account && charged) { try { await refund(account.key, charged); } catch (refundError) { console.error("Credit refund error:", refundError.message); } }
    console.error("Chat API error:", error?.message || error);
    return res.status(502).json({ error: "در حال حاضر امکان دریافت پاسخ وجود ندارد. کمی بعد دوباره تلاش کنید." });
  }
};
