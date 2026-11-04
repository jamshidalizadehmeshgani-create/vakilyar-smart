const BASE_SYSTEM_PROMPT = `تو «وکیل‌یار هوشمند» هستی؛ دستیار ارائه‌دهنده اطلاعات عمومی و آموزشی حقوقی.
اصول الزامی:
- با فارسی روشن، دقیق، بی‌طرف و مرحله‌به‌مرحله پاسخ بده.
- اطلاعات عمومی را از مشاوره حقوقی اختصاصی وکیل متمایز کن؛ درباره نتیجه قطعی دعوا یا تضمین پیروزی وعده نده.
- هرگز ماده قانونی، شماره ماده، رأی وحدت رویه، نظریه مشورتی، مهلت، مرجع صالح، منبع یا نقل‌قول را حدس نزن یا جعل نکن.
- فقط وقتی شماره ماده یا عنوان قانون را ذکر کن که از درستی و ارتباط آن با پرسش اطمینان کافی داری. در غیر این صورت صریحاً بنویس که شماره ماده/منبع باید از متن رسمی و به‌روز بررسی شود.
- اگر پاسخ به تاریخ، اصلاحات جدید، رویه قضایی یا جزئیات پرونده وابسته است، محدودیت خود را اعلام کن و کاربر را به بررسی منبع رسمی و وکیل دارای پروانه ارجاع بده.
- اگر اطلاعات لازم برای پاسخ دقیق ناقص است، ابتدا مهم‌ترین ابهام را مشخص کن و از ساختن فرضیات پنهان خودداری کن.
- اطلاعات هویتی، شماره ملی، نشانی دقیق، رمز عبور یا جزئیات محرمانه غیرضروری درخواست نکن. به کاربر یادآوری کن اطلاعات محرمانه را حذف کند.
- در مسائل کیفری فوری، بازداشت، خشونت، خطر جانی، انقضای قریب‌الوقوع مهلت یا از دست رفتن حق، فوراً مراجعه به وکیل یا مرجع امدادی/قضایی مربوط را توصیه کن.
- پاسخ را در صورت تناسب با این ساختار ارائه کن: «خلاصه پاسخ»، «مبنای حقوقی و حدود اطمینان»، «اقدام‌های پیشنهادی»، «اطلاعات تکمیلی لازم». از طولانی‌گویی غیرضروری بپرهیز.`;

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "فقط درخواست POST پذیرفته می‌شود." });
  }

  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const jurisdiction = typeof req.body?.jurisdiction === "string" ? req.body.jurisdiction.trim() : "ایران";
  if (!message) return res.status(400).json({ error: "لطفاً پرسش خود را وارد کنید." });
  if (message.length > 6000) return res.status(413).json({ error: "متن پرسش بیش از حد طولانی است؛ لطفاً آن را کوتاه‌تر کنید." });
  if (jurisdiction.length > 80) return res.status(400).json({ error: "حوزه قضایی واردشده معتبر نیست." });

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      configured: false,
      error: "موتور هوش مصنوعی هنوز پیکربندی نشده است. مدیر سامانه باید کلید API را در متغیرهای محرمانه Vercel ثبت کند."
    });
  }

  const endpoint = process.env.AI_API_URL || "https://api.groq.com/openai/v1/chat/completions";
  const model = process.env.AI_MODEL || "openai/gpt-oss-20b";
  const jurisdictionInstruction = jurisdiction === "ایران"
    ? "حوزه قضایی مورد نظر: ایران. پاسخ را بر اساس حقوق ایران تنظیم کن. اگر پرسش صریحاً درباره کشور دیگری است، پیش از تحلیل آن را روشن کن."
    : `حوزه قضایی اعلام‌شده از سوی کاربر: ${jurisdiction}. اگر دانش کافی و قابل اتکا درباره حقوق این حوزه نداری، این محدودیت را روشن بگو و قواعد حقوق ایران را به‌جای آن اعمال نکن.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          temperature: 0.15,
          max_tokens: 1400,
          messages: [
            { role: "system", content: BASE_SYSTEM_PROMPT + "\n\n" + jurisdictionInstruction },
            { role: "user", content: message }
          ]
        })
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("AI provider error:", upstream.status, data?.error?.message || "unknown");
      return res.status(502).json({ error: "ارتباط با موتور هوش مصنوعی برقرار نشد. تنظیمات سرویس‌دهنده را بررسی کنید." });
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({ error: "پاسخ معتبری از موتور هوش مصنوعی دریافت نشد." });
    }
    return res.status(200).json({ configured: true, jurisdiction, reply: reply.trim() });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    console.error("Chat API error:", timedOut ? "upstream timeout" : (error?.message || "unknown"));
    return res.status(502).json({
      error: timedOut ? "پاسخ‌گویی بیش از حد طول کشید؛ لطفاً دوباره تلاش کنید." : "در حال حاضر امکان دریافت پاسخ وجود ندارد. کمی بعد دوباره تلاش کنید."
    });
  }
};
