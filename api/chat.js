const crypto = require("crypto");
const { getAccount, classifyRequest, reserveCredits, refundReservation, commitReservation, consumeIpRateLimit } = require("../lib/quota");

const SYSTEM_PROMPT = `تو «وکیل‌یار هوشمند» هستی؛ دستیار ارائه‌دهنده اطلاعات عمومی و آموزشی حقوقی.
اصول الزامی:
- با فارسی روشن، دقیق، بی‌طرف، محترمانه و مرحله‌به‌مرحله پاسخ بده.
- حوزه پیش‌فرض و نسخه رایگان فقط قوانین جمهوری اسلامی ایران است. حقوق بین‌الملل یا قوانین سایر کشورها فقط برای کاربر Pro و در صورت انتخاب صریح حوزه حقوقی مربوط مجاز است؛ حقوق بین‌الملل را قانون واحد تلقی نکن.
- اگر درخواست مربوط به کشور یا حوزه‌ای است که کاربر Pro نیست یا حوزه آن روشن نیست، قواعد ایران را به‌جای آن اعمال نکن؛ محدودیت دسترسی یا ابهام حوزه را روشن بیان کن.
- اطلاعات عمومی را از مشاوره اختصاصی وکیل متمایز کن؛ نتیجه قطعی دعوا، پیروزی یا تضمین حقوقی وعده نده.
- هرگز ماده قانونی، شماره ماده، رأی وحدت رویه، نظریه مشورتی، شماره پرونده، مهلت، مرجع صالح، منبع یا نقل‌قول را حدس نزن یا جعل نکن.
- فقط وقتی شماره ماده یا عنوان قانون را ذکر کن که از درستی و ارتباط آن با پرسش اطمینان کافی داری. در غیر این صورت صریحاً بگو شماره ماده و منبع باید از متن رسمی و به‌روز بررسی شود.
- اگر پاسخ به تاریخ، اصلاحات جدید، رویه قضایی یا جزئیات پرونده وابسته است، محدودیت خود را اعلام کن و بررسی منبع رسمی و مشورت با وکیل دارای پروانه را توصیه کن.
- اگر اطلاعات لازم ناقص است، مهم‌ترین ابهام را مشخص کن و از ساختن فرضیات پنهان خودداری کن.
- اطلاعات هویتی، شماره ملی، نشانی دقیق، رمز عبور یا جزئیات محرمانه غیرضروری درخواست نکن؛ به کاربر یادآوری کن اطلاعات محرمانه را حذف کند.
- در مسائل کیفری فوری، بازداشت، خشونت، خطر جانی، انقضای قریب‌الوقوع مهلت یا احتمال از دست رفتن حق، فوراً مراجعه به وکیل یا مرجع امدادی/قضایی مربوط را توصیه کن.
- در صورت تناسب، پاسخ را با بخش‌های «خلاصه پاسخ»، «مبنای حقوقی و حدود اطمینان»، «اقدام‌های پیشنهادی» و «اطلاعات تکمیلی لازم» تنظیم کن.
- اگر منبع رسمی یا پایگاه قوانین به تو متصل نیست، ادعا نکن که قانون را جست‌وجو یا آخرین اصلاحات را بررسی کرده‌ای.`;

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
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

  // Keep client-provided legal-scope metadata out of the system prompt unless
  // it matches a small, bounded, plain-text format.
  const requestedScopeInput = req.body?.legal_scope;
  const requestedCountryInput = req.body?.country;
  if (requestedScopeInput !== undefined &&
      (typeof requestedScopeInput !== "string" ||
       !["iran", "international", "foreign"].includes(requestedScopeInput.trim().toLowerCase()))) {
    return res.status(400).json({ code: "INVALID_LEGAL_SCOPE", error: "حوزه حقوقی انتخاب‌شده معتبر نیست." });
  }
  if (requestedCountryInput !== undefined &&
      (typeof requestedCountryInput !== "string" ||
       requestedCountryInput.trim().length > 60 ||
       !/^[\\p{L}\\p{M}][\\p{L}\\p{M} .’'-]{0,59}$/u.test(requestedCountryInput.trim()))) {
    return res.status(400).json({ code: "INVALID_COUNTRY", error: "نام کشور باید کوتاه و فقط شامل حروف باشد." });
  }
  const countryLabel = typeof requestedCountryInput === "string" ? requestedCountryInput.trim() : "";

  // Support the earlier lowercase Vercel variable name as a backward-compatible fallback.
  const apiKey = process.env.AI_API_KEY || process.env.ai_api_key;
  if (!apiKey) {
    return res.status(503).json({
      configured: false,
      code: "AI_NOT_CONFIGURED",
      error: "موتور هوش مصنوعی پیکربندی نشده است. تا زمان فعال‌سازی اتصال معتبر، امکان دریافت پاسخ حقوقی وجود ندارد."
    });
  }

  let account;
  try {
    const ipLimit = await consumeIpRateLimit(req);
    if (ipLimit.count > ipLimit.limit) {
      res.setHeader("Retry-After", String(ipLimit.windowSeconds));
      return res.status(429).json({ code: "CHAT_RATE_LIMITED", error: "تعداد درخواست‌ها از این اتصال بیش از حد مجاز است؛ ۱۵ دقیقه بعد دوباره تلاش کنید." });
    }
  } catch (error) {
    if (error?.code === "CLIENT_IP_UNAVAILABLE") {
      return res.status(503).json({ code: "CLIENT_IP_UNAVAILABLE", error: "تشخیص امن اتصال ممکن نیست؛ لطفاً کمی بعد دوباره تلاش کنید." });
    }
    console.error("Chat IP rate-limit error:", error?.message || error);
    return res.status(503).json({ code: "CHAT_RATE_LIMIT_UNAVAILABLE", error: "سامانه کنترل تعداد درخواست‌ها موقتاً در دسترس نیست." });
  }
  let charged = 0;
  let reservationId = null;
  let remainingCredits = null;
  const endpoint = process.env.AI_API_URL || "https://api.groq.com/openai/v1/chat/completions";
  const model = process.env.AI_MODEL || "openai/gpt-oss-20b";

  try {
    account = await getAccount(req, res);
    const requestedScope = typeof requestedScopeInput === "string" ? requestedScopeInput.trim().toLowerCase() : "";
    const requestedCountry = countryLabel.toLowerCase();
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
    const explicitForeignLaw = /حقوق بین.?الملل|قوانین بین.?الملل|قانون بین.?الملل|حقوق خارجی|قوانین? خارجی|کشورهای خارجی|کشور خارجی|قوانین? (?:کشور|دولت) دیگر|قانون (?:کشور|دولت) دیگر/i.test(message);
    const scopeRequestsForeign = (requestedScope && !iranAliases.has(requestedScope)) ||
      (requestedCountry && !iranAliases.has(requestedCountry));
    const foreignRequest = scopeRequestsForeign || explicitForeignLaw || foreignCountryMention;
    if (foreignRequest && !account.isPro) {
      return res.status(403).json({ code: "PRO_REQUIRED", error: "بررسی حقوق بین‌الملل و قوانین سایر کشورها در وکیل‌یار پرو ارائه می‌شود." });
    }
    if (!account.isPro && !account.isUnlimited) {
      charged = classifyRequest(message);
      reservationId = crypto.randomBytes(16).toString("hex");
      remainingCredits = await reserveCredits(account.key, charged, reservationId);
      if (remainingCredits < 0) return res.status(402).json({ code: "CREDITS_EXHAUSTED", error: "اعتبار رایگان شما به پایان رسیده است. برای ادامه، وکیل‌یار پرو را فعال کنید." });
    }
    const scopeLabel = foreignRequest ? (countryLabel || "حوزه حقوقی انتخاب‌شده") : "قوانین جمهوری اسلامی ایران";
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
      if (reservationId) { await refundReservation(account.key, reservationId); reservationId = null; }
      return res.status(502).json({ error: "ارتباط با موتور هوش مصنوعی برقرار نشد؛ اعتبار رزروشده بازگردانده شد." });
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) { if (reservationId) { await refundReservation(account.key, reservationId); reservationId = null; } return res.status(502).json({ error: "پاسخ معتبری دریافت نشد؛ اعتبار رزروشده بازگردانده شد." }); }
    if (reservationId) {
      const committed = await commitReservation(reservationId);
      if (committed !== 1) throw new Error("Credit reservation could not be committed");
      reservationId = null;
    }
    return res.status(200).json({ configured: true, reply, plan: account.isPro ? "pro" : "free", unlimited: account.isUnlimited, credits_used: charged, credits_remaining: (account.isPro || account.isUnlimited) ? null : remainingCredits });
  } catch (error) {
    if (account && reservationId) { try { await refundReservation(account.key, reservationId); reservationId = null; } catch (refundError) { console.error("Credit refund error:", refundError.message); } }
    console.error("Chat API error:", error?.message || error);
    return res.status(502).json({ error: "در حال حاضر امکان دریافت پاسخ وجود ندارد. کمی بعد دوباره تلاش کنید." });
  }
};
