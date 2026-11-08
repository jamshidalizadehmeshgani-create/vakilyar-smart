"use strict";

// One Vercel Serverless Function dispatches all public API routes.
// Keep this allowlist explicit: never resolve a module from user-controlled input.
const handlers = new Map([
  ["admin/grant-credits", require("../handlers/admin/grant-credits")],
  ["admin/lawyers", require("../handlers/admin/lawyers")],
  ["chat", require("../handlers/chat")],
  ["lawyer/login", require("../handlers/lawyer/login")],
  ["lawyer/logout", require("../handlers/lawyer/logout")],
  ["lawyer/me", require("../handlers/lawyer/me")],
  ["lawyer/questions", require("../handlers/lawyer/questions")],
  ["lawyer/reply", require("../handlers/lawyer/reply")],
  ["lawyer/resend-verification", require("../handlers/lawyer/resend-verification")],
  ["lawyer/verify-email", require("../handlers/lawyer/verify-email")],
  ["lawyers/active", require("../handlers/lawyers/active")],
  ["questions/create", require("../handlers/questions/create")],
  ["questions/mine", require("../handlers/questions/mine")],
  ["usage", require("../handlers/usage")],
  ["users/login", require("../handlers/users/login")],
  ["users/logout", require("../handlers/users/logout")],
  ["users/me", require("../handlers/users/me")],
  ["users/register", require("../handlers/users/register")],
  ["users/resend-verification", require("../handlers/users/resend-verification")],
  ["users/verify", require("../handlers/users/verify")]
]);

module.exports = async function apiRouter(req, res) {
  const route = req.query && req.query.route;

  if (typeof route !== "string" || !handlers.has(route)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ error: "API route not found" });
  }

  return handlers.get(route)(req, res);
};
