"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  REGISTRY_ENV,
  buildAttestationMessage,
  verifyHumanAttestation
} = require("../lib/legal-human-attestation");

const today = new Date().toISOString().slice(0, 10);
const names = [
  ["reviewer-a", "بازبین الف", "reviewer"],
  ["reviewer-b", "بازبین ب", "reviewer"],
  ["approver-a", "تأییدکننده الف", "approver"],
  ["approver-b", "تأییدکننده ب", "approver"]
];
const identities = names.map(([identityId, displayName, role]) => ({
  identityId,
  displayName,
  role,
  keyId: identityId + "-v1",
  ...crypto.generateKeyPairSync("ed25519")
}));
const trustedRegistry = identities.map(identity => ({
  identityId: identity.identityId,
  keyId: identity.keyId,
  displayName: identity.displayName,
  role: identity.role,
  active: true,
  publicKeyPem: identity.publicKey.export({ type: "spki", format: "pem" })
}));
const intake = {
  legalReview: { reviewedBy: ["بازبین الف", "بازبین ب"], reviewedAt: today },
  promotion: { approvedBy: ["تأییدکننده الف", "تأییدکننده ب"], approvedAt: today },
  document: { title: "قانون آزمایشی" },
  articleChecks: [{ articleNumber: "۱", text: "متن ماده" }]
};
const originalRegistry = process.env[REGISTRY_ENV];

function withRegistry(registry, callback) {
  process.env[REGISTRY_ENV] = JSON.stringify(registry);
  try { callback(); }
  finally {
    if (originalRegistry === undefined) delete process.env[REGISTRY_ENV];
    else process.env[REGISTRY_ENV] = originalRegistry;
  }
}

function signRole(candidate, role, signedAt) {
  return identities.filter(identity => identity.role === role).map(identity => ({
    identityId: identity.identityId,
    keyId: identity.keyId,
    signedAt,
    signature: crypto.sign(
      null,
      Buffer.from(buildAttestationMessage(candidate, role, identity.identityId, identity.keyId, signedAt), "utf8"),
      identity.privateKey
    ).toString("base64")
  }));
}

function signedIntake(candidate = structuredClone(intake), reviewerAt = new Date(Date.now() - 30_000).toISOString(), approverAt = new Date(Date.now() - 10_000).toISOString()) {
  candidate.humanAttestations = {
    scheme: "Ed25519",
    reviewerSignatures: signRole(candidate, "reviewer", reviewerAt),
    approverSignatures: signRole(candidate, "approver", approverAt)
  };
  return candidate;
}

test("accepts four valid independent Ed25519 attestations", () => {
  withRegistry(trustedRegistry, () => assert.equal(verifyHumanAttestation(signedIntake()), true));
});

test("rejects a document changed after signing", () => {
  withRegistry(trustedRegistry, () => {
    const candidate = signedIntake();
    candidate.articleChecks[0].text += " دستکاری";
    assert.equal(verifyHumanAttestation(candidate), false);
  });
});

test("rejects reviewer signatures presented as approver signatures", () => {
  withRegistry(trustedRegistry, () => {
    const candidate = signedIntake();
    candidate.humanAttestations.approverSignatures = candidate.humanAttestations.reviewerSignatures;
    assert.equal(verifyHumanAttestation(candidate), false);
  });
});

test("rejects duplicate signer identities", () => {
  withRegistry(trustedRegistry, () => {
    const candidate = signedIntake();
    candidate.humanAttestations.reviewerSignatures[1] = candidate.humanAttestations.reviewerSignatures[0];
    assert.equal(verifyHumanAttestation(candidate), false);
  });
});

test("rejects an approver signature made before the reviewers finished", () => {
  withRegistry(trustedRegistry, () => {
    const reviewerAt = new Date(Date.now() - 10_000).toISOString();
    const approverAt = new Date(Date.now() - 30_000).toISOString();
    assert.equal(verifyHumanAttestation(signedIntake(structuredClone(intake), reviewerAt, approverAt)), false);
  });
});

test("rejects signatures dated before the legal review", () => {
  withRegistry(trustedRegistry, () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    assert.equal(verifyHumanAttestation(signedIntake(structuredClone(intake), yesterday, yesterday)), false);
  });
});

test("rejects a revoked public key", () => {
  const revoked = trustedRegistry.map(entry => ({ ...entry }));
  revoked[0].active = false;
  withRegistry(revoked, () => assert.equal(verifyHumanAttestation(signedIntake()), false));
});

test("rejects a missing trusted registry", () => {
  const previous = process.env[REGISTRY_ENV];
  delete process.env[REGISTRY_ENV];
  try { assert.equal(verifyHumanAttestation(signedIntake()), false); }
  finally {
    if (previous === undefined) delete process.env[REGISTRY_ENV];
    else process.env[REGISTRY_ENV] = previous;
  }
});

test("rejects one public key assigned to multiple people", () => {
  const duplicate = trustedRegistry.map(entry => ({ ...entry }));
  duplicate[1].publicKeyPem = duplicate[0].publicKeyPem;
  withRegistry(duplicate, () => assert.equal(verifyHumanAttestation(signedIntake()), false));
});

test("rejects malformed Base64 signatures", () => {
  withRegistry(trustedRegistry, () => {
    const candidate = signedIntake();
    candidate.humanAttestations.reviewerSignatures[0].signature = "not-base64??";
    assert.equal(verifyHumanAttestation(candidate), false);
  });
});

test("rejects impossible UTC signature timestamps", () => {
  withRegistry(trustedRegistry, () => {
    const candidate = signedIntake();
    candidate.humanAttestations.reviewerSignatures[0].signedAt = "2026-02-30T12:00:00.000Z";
    assert.equal(verifyHumanAttestation(candidate), false);
  });
});
