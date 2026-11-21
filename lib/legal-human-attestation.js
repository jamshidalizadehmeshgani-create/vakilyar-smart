"use strict";

const crypto = require("node:crypto");

const REGISTRY_ENV = "LEGAL_ATTESTATION_KEYS_JSON";
const DOMAIN = "vakilyar:legal-intake:ed25519:v1";
const ROLES = ["reviewer", "approver"];
const NAME_FIELDS = { reviewer: ["legalReview", "reviewedBy"], approver: ["promotion", "approvedBy"] };

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite numbers are not valid in legal attestations.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Only plain JSON objects can be signed.");
  }
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalize(value[key])).join(",") + "}";
}

function signedPayload(intake) {
  if (!intake || typeof intake !== "object" || Array.isArray(intake)) throw new TypeError("Invalid intake.");
  const payload = { ...intake };
  delete payload.humanAttestations;
  const canonical = canonicalize(payload);
  if (Buffer.byteLength(canonical, "utf8") > 2 * 1024 * 1024) throw new RangeError("Legal intake exceeds the attestation size limit.");
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function buildAttestationMessage(intake, role, identityId, keyId, signedAt) {
  if (!ROLES.includes(role) || ![identityId, keyId, signedAt].every(value => typeof value === "string" && value.length > 0)) {
    throw new TypeError("Invalid attestation metadata.");
  }
  return [DOMAIN, role, identityId, keyId, signedAt, signedPayload(intake)].join("\\n");
}

function readRegistry() {
  const raw = process.env[REGISTRY_ENV];
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length < 4) return null;
  const registry = new Map();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        typeof entry.identityId !== "string" || !entry.identityId.trim() ||
        typeof entry.keyId !== "string" || !entry.keyId.trim() ||
        typeof entry.displayName !== "string" || !entry.displayName.trim() ||
        !ROLES.includes(entry.role) || entry.active !== true ||
        typeof entry.publicKeyPem !== "string" || !entry.publicKeyPem.includes("BEGIN PUBLIC KEY")) return null;
    const mapKey = entry.identityId + ":" + entry.keyId;
    if (registry.has(mapKey)) return null;
    let publicKey;
    try { publicKey = crypto.createPublicKey(entry.publicKeyPem); } catch { return null; }
    if (publicKey.asymmetricKeyType !== "ed25519") return null;
    registry.set(mapKey, { ...entry, publicKey });
  }
  return registry;
}

function validSignedAt(value) {
  return typeof value === "string" &&
    /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now();
}

function verifyRole(intake, signatures, role, registry) {
  if (!Array.isArray(signatures) || signatures.length < 2) return false;
  const identities = new Set();
  const displayNames = new Set();
  const expectedNames = intake?.[NAME_FIELDS[role][0]]?.[NAME_FIELDS[role][1]];
  if (!Array.isArray(expectedNames) || expectedNames.length < 2) return false;
  const expected = new Set(expectedNames.map(name => typeof name === "string" ? name.normalize("NFKC").trim() : ""));
  if (expected.has("") || expected.size !== expectedNames.length) return false;

  for (const item of signatures) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.identityId !== "string" || typeof item.keyId !== "string" ||
        typeof item.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.signature) ||
        !validSignedAt(item.signedAt) || identities.has(item.identityId)) return false;
    const identity = registry.get(item.identityId + ":" + item.keyId);
    if (!identity || identity.role !== role || identities.has(identity.identityId)) return false;
    const displayName = identity.displayName.normalize("NFKC").trim();
    if (displayNames.has(displayName) || !expected.has(displayName)) return false;
    const signature = Buffer.from(item.signature, "base64");
    if (!signature.length || signature.toString("base64") !== item.signature) return false;
    let valid = false;
    try {
      valid = crypto.verify(null, Buffer.from(buildAttestationMessage(intake, role, item.identityId, item.keyId, item.signedAt), "utf8"), identity.publicKey, signature);
    } catch { valid = false; }
    if (!valid) return false;
    identities.add(item.identityId);
    displayNames.add(displayName);
  }
  return identities.size >= 2 && displayNames.size === expected.size &&
    [...expected].every(name => displayNames.has(name));
}

function verifyHumanAttestation(intake) {
  const registry = readRegistry();
  if (!registry) return false;
  const attestations = intake?.humanAttestations;
  if (!attestations || typeof attestations !== "object" || Array.isArray(attestations) ||
      attestations.scheme !== "Ed25519" || !Array.isArray(attestations.reviewerSignatures) ||
      !Array.isArray(attestations.approverSignatures)) return false;
  const reviewerIds = new Set(attestations.reviewerSignatures.map(item => item?.identityId).filter(value => typeof value === "string"));
  const approverIds = new Set(attestations.approverSignatures.map(item => item?.identityId).filter(value => typeof value === "string"));
  if (reviewerIds.size !== attestations.reviewerSignatures.length ||
      approverIds.size !== attestations.approverSignatures.length ||
      [...reviewerIds].some(id => approverIds.has(id))) return false;
  return verifyRole(intake, attestations.reviewerSignatures, "reviewer", registry) &&
    verifyRole(intake, attestations.approverSignatures, "approver", registry);
}

module.exports = { REGISTRY_ENV, canonicalize, signedPayload, buildAttestationMessage, verifyHumanAttestation };
