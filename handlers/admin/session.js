"use strict";
const { loginAdmin, logoutAdmin, authorizeAdmin } = require("../../lib/admin-auth");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "فقط درخواست POST پذیرفته می‌شود." });
  }
  try {
    const action = req.body?.action;
    if (action === "login") {
      if (!await loginAdmin(req, res)) return;
      return res.status(200).json({ ok: true, message: "نشست امن مالک ایجاد شد." });
    }
    if (action === "logout") {
      if (!await logoutAdmin(req, res)) return;
      return res.status(200).json({ ok: true, message: "از فضای مالک خارج شدید." });
    }
    if (action === "check") {
      if (!await authorizeAdmin(req, res)) return;
      return res.status(200).json({ ok: true, authenticated: true });
    }
    return res.status(400).json({ error: "عملیات نشست معتبر نیست." });
  } catch {
    console.error("Owner session operation failed");
    return res.status(503).json({ error: "ایجاد یا پایان نشست مالک موقتاً ممکن نیست." });
  }
};
