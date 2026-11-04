module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    service: "vakilyar-smart-api",
    version: "0.1.0",
    message: "سرویس وکیل‌یار فعال است."
  });
};
