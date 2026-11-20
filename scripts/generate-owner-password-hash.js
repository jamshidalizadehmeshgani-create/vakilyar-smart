"use strict";

// Run locally with Node.js 22: node scripts/generate-owner-password-hash.js
// The password is read without terminal echo and is never written to a file or sent over the network.
const crypto = require("node:crypto");

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
  process.stderr.write("این ابزار باید در ترمینال تعاملی اجرا شود تا رمز هنگام تایپ نمایش داده نشود.\n");
  process.exit(1);
}

let password = "";
process.stdout.write("رمز عبور مالک (حداقل ۱۲ نویسه؛ تایپ مخفی است): ");
process.stdin.setEncoding("utf8");
process.stdin.setRawMode(true);
process.stdin.resume();

function finish(code) {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  password = "";
  process.exitCode = code;
}

process.stdin.on("data", chunk => {
  for (const char of chunk) {
    if (char === "\u0003") {
      process.stdout.write("\nلغو شد.\n");
      finish(1);
      return;
    }
    if (char === "\r" || char === "\n") {
      process.stdout.write("\n");
      if (password.length < 12 || password.length > 1024) {
        process.stderr.write("رمز باید بین ۱۲ تا ۱۰۲۴ نویسه باشد.\n");
        finish(1);
        return;
      }
      const salt = crypto.randomBytes(16);
      crypto.scrypt(password, salt, 64, (error, derived) => {
        if (error) {
          process.stderr.write("ساخت هش ناموفق بود.\n");
          finish(1);
          return;
        }
        process.stdout.write("ADMIN_PASSWORD_HASH=scrypt$" + salt.toString("hex") + "$" + derived.toString("hex") + "\n");
        process.stdout.write("این مقدار را فقط در Secret محیط Preview با نام ADMIN_PASSWORD_HASH ثبت کنید.\n");
        finish(0);
      });
      return;
    }
    if (char === "\u007f" || char === "\b") {
      password = password.slice(0, -1);
    } else if (char >= " " && char !== "\u007f") {
      password += char;
    }
  }
});
