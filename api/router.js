"use strict";

const routes = Object.freeze({
  "admin/grant-credits": require("../lib/api-handlers/admin/grant-credits"),
  "admin/lawyers": require("../lib/api-handlers/admin/lawyers"),
  "chat": require("../lib/api-handlers/chat"),
  "lawyer/login": require("../lib/api-handlers/lawyer/login"),
  "lawyer/logout": require("../lib/api-handlers/lawyer/logout"),
  "lawyer/me": require("../lib/api-handlers/lawyer/me"),
  "lawyer/questions": require("../lib/api-handlers/lawyer/questions"),
  "lawyer/reply": require("../lib/api-handlers/lawyer/reply"),
  "lawyer/resend-verification": require("../lib/api-handlers/lawyer/resend-verification"),
  "lawyer/verify-email": require("../lib/api-handlers/lawyer/verify-email"),
  "lawyers/active": require("../lib/api-handlers/lawyers/active"),
  "questions/create": require("../lib/api-handlers/questions/create"),
  "questions/mine": require("../lib/api-handlers/questions/mine"),
  "usage": require("../lib/api-handlers/usage"),
  "users/login": require("../lib/api-handlers/users/login"),
  "users/logout": require("../lib/api-handlers/users/logout"),
  "users/me": require("../lib/api-handlers/users/me"),
  "users/register": require("../lib/api-handlers/users/register"),
  "users/resend-verification": require("../lib/api-handlers/users/resend-verification"),
  "users/verify": require("../lib/api-handlers/users/verify"),
});

module.exports = async function apiRouter(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const route = req.query && req.query.__vy_route;
  if (typeof route !== "string" || !Object.prototype.hasOwnProperty.call(routes, route)) {
    return res.status(404).json({ error: "مسیر API پیدا نشد." });
  }
  return routes[route](req, res);
};

module.exports.routes = routes;
