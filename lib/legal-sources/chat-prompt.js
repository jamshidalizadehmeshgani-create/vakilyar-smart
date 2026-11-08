"use strict";

/**
 * Compose the system message sent to the AI provider.
 * Curated Iranian legal context is included only for non-foreign requests.
 */
function buildChatSystemMessage(systemPrompt, scopeLabel, foreignRequest, verifiedLegalContext) {
  const scope = typeof scopeLabel === "string" ? scopeLabel : "";
  const legalContext = !foreignRequest && typeof verifiedLegalContext === "string"
    ? verifiedLegalContext.trim()
    : "";
  return systemPrompt + "\nحوزه حقوقی این درخواست: " + scope +
    (legalContext ? "\n\n" + legalContext : "");
}

module.exports = { buildChatSystemMessage };
