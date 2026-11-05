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

  const host = req.headers.host || "";
  let originHost = "";
  try { originHost = new URL(req.headers.origin || "").host; } catch {}
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (!host || !originHost || originHost !== host || (fetchSite && fetchSite !== "same-origin")) {
    return res.status(403).json({ error: "مبدأ درخواست معتبر نیست؛ صفحه را تازه‌سازی و دوباره تلاش کنید." });
  }

  if (req.body?.consent !== true) return res.status(400).json({ error: "برای ارسال متن پرسش به سرویس هوش مصنوعی، رضایت صریح شما لازم است." });

  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "لطفاً پرسش خود را وارد کنید." });
  if (message.length > 6000) return res.status(413).json({ error: "متن پرسش بیش از حد طولانی است." });

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      configured: false,
      code: "AI_NOT_CONFIGURED",
      error: "موتور هوش مصنوعی پیکربندی نشده است. تا زمان فعال‌سازی اتصال معتبر، امکان دریافت پاسخ حقوقی وجود ندارد."
    });
  }

  let account;
  let charged = 0;
  let creditsReserved = false;
  let remainingCredits = null;
  const endpoint = process.env.AI_API_URL || "https://api.groq.com/openai/v1/chat/completions";
  const model = process.env.AI_MODEL || "openai/gpt-oss-20b";

  try {
    account = await getAccount(req, res);
    const requestedScope = typeof req.body?.legal_scope === "string" ? req.body.legal_scope.trim().toLowerCase() : "";
    const requestedCountry = typeof req.body?.country === "string" ? req.body.country.trim().toLowerCase() : "";
    const iranAliases = new Set(["iran", "ایران", "ir"]);
    const foreignCountryNames = [
      "آلمان","ژاپن","چین","روسیه","آمریکا","ایالات متحده","انگلستان","بریتانیا","فرانسه","ترکیه",
      "کانادا","استرالیا","ایتالیا","اسپانیا","هلند","بلژیک","سوئیس","اتریش","سوئد","نروژ","دانمارک",
      "فنلاند","لهستان","اوکراین","هند","پاکستان","افغانستان","عراق","عربستان","امارات","قطر","کویت",
      "بحرین","عمان","مصر","لبنان","سوریه","اردن","آذربایجان","ارمنستان","گرجستان","ژاپن","کره جنوبی",
      "سنگاپور","مالزی","اندونزی","تایلند","برزیل","مکزیک","آفریقای جنوبی","نیوزیلند",
      "germany","japan","china","russia","united states","usa","america","united kingdom","uk",
      "england","france","turkey","canada","australia","italy","spain","netherlands","belgium",
      "switzerland","austria","sweden","norway","denmark","finland","poland","ukraine","india",
      "pakistan","afghanistan","iraq","saudi arabia","uae","qatar","kuwait","bahrain","oman",
      "egypt","lebanon","syria","jordan","azerbaijan","armenia","georgia","south korea","singapore",
      "malaysia","indonesia","thailand","brazil","mexico","south africa","new zealand"
    ];
    const foreignCountryMention = foreignCountryNames.some(name =>
      new RegExp("(^|[^\\p{L}])" + name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + "([^\\p{L}]|$)", "iu").test(message)
    );
    const explicitForeignLaw = /حقوق بین.?الملل|قوانین بین.?الملل|قانون بین.?الملل|قوانین? (?:کشور|دولت) دیگر|قانون (?:کشور|دولت) دیگر/i.test(message);
    const scopeRequestsForeign = (requestedScope && !iranAliases.has(requestedScope)) ||
      (requestedCountry && !iranAliases.has(requestedCountry));
    const foreignRequest = scopeRequestsForeign || explicitForeignLaw || foreignCountryMention;
    if (foreignRequest && !account.isPro) {
      return res.status(403).json({ code: "PRO_REQUIRED", error: "بررسی حقوق بین‌الملل و قوانین سایر کشورها در وکیل‌یار پرو ارائه می‌شود." });
    }
    if (!account.isPro && !account.isUnlimited) {
      charged = classifyRequest(message);
      remainingCredits = await consume(account.key, charged);
      if (remainingCredits < 0) return res.status(402).json({ code: "CREDITS_EXHAUSTED", error: "اعتبار رایگان شما به پایان رسیده است. برای ادامه، وکیل‌یار پرو را فعال کنید." });
      creditsReserved = true;
    }
    const scopeLabel = foreignRequest ? (req.body?.country || "حوزه حقوقی انتخاب‌شده") : "قوانین جمهوری اسلامی ایران";
    const upstream = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(25000),
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
      if (creditsReserved) { await refund(account.key, charged); creditsReserved = false; }
      return res.status(502).json({ error: "ارتباط با موتور هوش مصنوعی برقرار نشد؛ اعتبار رزروشده بازگردانده شد." });
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) { if (creditsReserved) { await refund(account.key, charged); creditsReserved = false; } return res.status(502).json({ error: "پاسخ معتبری دریافت نشد؛ اعتبار رزروشده بازگردانده شد." }); }
    return res.status(200).json({ configured: true, reply, plan: account.isPro ? "pro" : "free", unlimited: account.isUnlimited, credits_used: charged, credits_remaining: (account.isPro || account.isUnlimited) ? null : remainingCredits });
  } catch (error) {
    if (account && creditsReserved) { try { await refund(account.key, charged); creditsReserved = false; } catch (refundError) { console.error("Credit refund error:", refundError.message); } }
    console.error("Chat API error:", error?.message || error);
    return res.status(502).json({ error: "در حال حاضر امکان دریافت پاسخ وجود ندارد. کمی بعد دوباره تلاش کنید." });
  }
};
