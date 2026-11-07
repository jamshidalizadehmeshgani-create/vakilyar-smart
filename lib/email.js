const DEFAULT_APP_URL = "https://vakilyar-smart.vercel.app";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

async function sendWelcomeEmail({ to, name, role, loginUrl, details = [], features = [] }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "").trim();
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ""))) {
    return { sent: false, reason: "invalid_recipient" };
  }
  const safe = escapeHtml;
  const detailRows = details.map(([label, value]) =>
    `<tr><td style="padding:7px;border-bottom:1px solid #eee;color:#667085">${safe(label)}</td><td style="padding:7px;border-bottom:1px solid #eee;font-weight:bold">${safe(value)}</td></tr>`
  ).join("");
  const featureRows = features.map((feature) => `<li style="margin:8px 0">${safe(feature)}</li>`).join("");
  const html = `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><body style="margin:0;background:#f5f3ee;font-family:Tahoma,Arial,sans-serif;color:#14233f"><main style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #eadfce;border-radius:16px;overflow:hidden"><header style="background:#14233f;color:#f1d28a;text-align:center;padding:28px"><h1 style="margin:0">به وکیل‌یار خوش آمدید</h1><p style="color:#fff;margin-bottom:0">همراه هوشمند شما در مسیر خدمات حقوقی مطمئن</p></header><section style="padding:28px;line-height:2"><h2>سلام ${safe(name)} عزیز،</h2><p>از پیوستن شما به خانواده وکیل‌یار خوشحالیم. حضور شما به ما کمک می‌کند مسیر دسترسی به خدمات حقوقی دقیق‌تر و مسئولانه‌تر شود.</p><p>اطلاعات ثبت‌شده حساب شما:</p><table style="width:100%;border-collapse:collapse">${detailRows}</table><h3>قدم بعدی</h3><ul>${featureRows}</ul><p style="text-align:center;margin:28px 0"><a href="${safe(loginUrl)}" style="display:inline-block;background:#c9a45c;color:#14233f;text-decoration:none;padding:12px 24px;border-radius:9px;font-weight:bold">ورود به پنل وکیل‌یار</a></p><p style="font-size:12px;color:#667085">برای حفظ امنیت، گذرواژه در این ایمیل ارسال نمی‌شود. از گذرواژه خود محافظت کنید و آن را با هیچ‌کس به اشتراک نگذارید.</p><hr style="border:0;border-top:1px solid #eee"><p style="font-size:12px;color:#667085">اگر این حساب را ایجاد نکرده‌اید، لطفاً این پیام را نادیده بگیرید و با پشتیبانی تماس بگیرید.</p></section></main></body></html>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [String(to).trim().toLowerCase()],
        subject: "به خانواده وکیل‌یار خوش آمدید",
        html
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { sent: false, reason: "provider_error" };
    return { sent: true };
  } catch {
    return { sent: false, reason: "provider_unavailable" };
  }
}


async function sendLawyerVerificationEmail({ to, name, token }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "").trim();
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(to || ""))) {
    return { sent: false, reason: "invalid_recipient" };
  }
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    return { sent: false, reason: "invalid_token" };
  }
  let base;
  try {
    base = new URL(process.env.APP_BASE_URL || DEFAULT_APP_URL);
    if (base.protocol !== "https:" && base.hostname !== "localhost") return { sent: false, reason: "invalid_app_url" };
  } catch { return { sent: false, reason: "invalid_app_url" }; }
  const verifyUrl = new URL("/api/lawyer/verify-email", base.origin);
  verifyUrl.searchParams.set("token", token);
  const html = `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><body style="font-family:Tahoma,Arial;background:#f5f3ee;color:#14233f;padding:24px"><main style="max-width:600px;margin:auto;background:white;border-radius:14px;overflow:hidden"><header style="background:#14233f;color:#f1d28a;padding:24px;text-align:center"><h1>تأیید ایمیل وکیل‌یار</h1></header><section style="padding:24px;line-height:2"><h2>سلام ${escapeHtml(name)} عزیز</h2><p>پرونده همکاری شما در وکیل‌یار ایجاد شده است. برای تأیید مالکیت نشانی ایمیل، روی دکمه زیر بزنید.</p><p style="text-align:center"><a style="display:inline-block;background:#c9a45c;color:#14233f;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold" href="${escapeHtml(verifyUrl.toString())}">تأیید ایمیل</a></p><p>این پیوند فقط یک‌بار قابل استفاده است و تا ۲۴ ساعت اعتبار دارد. اگر این درخواست را انتظار نداشتید، پیام را نادیده بگیرید.</p><p style="font-size:12px;color:#667085">گذرواژه در ایمیل ارسال نمی‌شود.</p></section></main></body></html>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [String(to).trim().toLowerCase()], subject: "تأیید ایمیل همکاری در وکیل‌یار", html }),
      signal: AbortSignal.timeout(8000)
    });
    return response.ok ? { sent: true } : { sent: false, reason: "provider_error" };
  } catch { return { sent: false, reason: "provider_unavailable" }; }
}

module.exports = { sendWelcomeEmail, sendLawyerVerificationEmail, escapeHtml };
