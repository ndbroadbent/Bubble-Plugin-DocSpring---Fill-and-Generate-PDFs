// New signature request actions (actions/_new).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, submission, v2Error, US } = require("./support/harness");

const waiting = () =>
  submission({
    state: "waiting_for_signature_requests",
    files: {},
    processed_at: null,
    signature_requests: [
      { id: "srq_1", state: "pending", fields: ["signature"] },
      { id: "srq_2", state: "pending", fields: ["signature_2"] }
    ]
  });
const token = (id, url) => ({ id: id, type: "api", secret: "secret", signature_request_url: url, expires_at: "2026-10-28T00:00:00Z" });

test("Create Signature Request creates the submission and a signing link per signer", async () => {
  const { result, calls } = await runAction("_new/create-signature-request", {
    templateId: "tpl_123",
    version: "latest",
    data: [{ key: "company", value: "Acme" }],
    test: true,
    signerName: "Jane Doe",
    signerEmail: "jane@example.com",
    signerRole: "Signer 1",
    signerFields: "signature, date_signed",
    authType: "email_link",
    prefilledValuesEditable: false,
    ignoreUnknownFields: true,
    signatureRequests: '[{"role": "Signer 2", "fields": ["signature_2"], "auth_type": "password"}]',
    signingLinkType: "api"
  }, {
    responses: [
      { method: "POST", uri: `${US}/templates/tpl_123/submissions?version=latest`, status: 201, body: waiting() },
      { method: "POST", uri: `${US}/signature_requests/srq_1/tokens`, status: 201, body: token("tok_1", "https://sign/1") },
      { method: "POST", uri: `${US}/signature_requests/srq_2/tokens`, status: 201, body: token("tok_2", "https://sign/2") }
    ]
  });
  assert.deepEqual(calls[0].json, {
    signature_requests: [
      {
        fields: ["signature", "date_signed"],
        auth_type: "email_link",
        name: "Jane Doe",
        email: "jane@example.com",
        role: "Signer 1",
        ignore_unknown_fields: true
      },
      { role: "Signer 2", fields: ["signature_2"], auth_type: "password" }
    ],
    data: { company: "Acme" },
    test: true
  });
  assert.deepEqual(calls[1].json, { type: "api" });
  assert.equal(result.success, true);
  assert.equal(result.state, "waiting_for_signature_requests");
  assert.deepEqual(result.signatureRequestIds, ["srq_1", "srq_2"]);
  assert.deepEqual(result.signingUrls, ["https://sign/1", "https://sign/2"]);
  assert.equal(result.firstSignatureRequestId, "srq_1");
  assert.equal(result.firstSigningUrl, "https://sign/1");
  assert.equal(JSON.parse(result.response).signature_requests[1].signing_url, "https://sign/2");
});

test("Create Signature Request leaves out empty data and makes no links with none", async () => {
  const { result, calls } = await runAction("_new/create-signature-request", {
    templateId: "tpl_123",
    signerFields: ["signature"],
    signingLinkType: "none"
  }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/submissions`, status: 201, body: waiting() }]
  });
  assert.deepEqual(calls[0].json, { signature_requests: [{ fields: ["signature"], auth_type: "email_link" }] });
  assert.deepEqual(result.signingUrls, [null, null]);
});

test("Create Signature Request needs a signer with fields", async () => {
  await assert.rejects(runAction("_new/create-signature-request", { templateId: "tpl_123" }), /Add a signer/);
  await assert.rejects(
    runAction("_new/create-signature-request", { templateId: "tpl_123", signerName: "Jane" }),
    /Signer Fields is required/
  );
  await assert.rejects(
    runAction("_new/create-signature-request", { templateId: "tpl_123", signerFields: "signature", authType: "none" }),
    /Auth Type must be one of/
  );
});

test("Create Signature Request names the submission when a link fails", async () => {
  const { result } = await runAction("_new/create-signature-request", {
    templateId: "tpl_123",
    signerFields: "signature",
    signingLinkType: "email"
  }, {
    responses: [
      { method: "POST", status: 201, body: waiting() },
      { method: "POST", uri: `${US}/signature_requests/srq_1/tokens`, status: 409, body: v2Error("conflict", "The signature request is completed") }
    ]
  });
  assert.equal(result.success, false);
  assert.equal(result.id, "sub_123");
  assert.equal(
    result.errorMessage,
    "DocSpring API error 409 conflict: The signature request is completed\nRequest ID: req_123\nSubmission: sub_123\nSignature request: srq_1"
  );
});

test("Create Signing Link sends the type in the body", async () => {
  const { result, calls } = await runAction("_new/create-signing-link", { signatureRequestId: "srq_1", type: "email" }, {
    responses: [{ method: "POST", uri: `${US}/signature_requests/srq_1/tokens`, status: 201, body: token("tok_1", "https://sign/1") }]
  });
  assert.deepEqual(calls[0].json, { type: "email" });
  assert.equal(result.id, "tok_1");
  assert.equal(result.signingUrl, "https://sign/1");
  assert.equal(result.expiresAt, "2026-10-28T00:00:00Z");
  await assert.rejects(runAction("_new/create-signing-link", { signatureRequestId: "srq_1", type: "sms" }), /Link Type must be api or email/);
});

test("Get Signature Request", async () => {
  const { result } = await runAction("_new/get-signature-request", { signatureRequestId: "srq_1" }, {
    responses: [{
      method: "GET",
      uri: `${US}/signature_requests/srq_1`,
      status: 200,
      body: { id: "srq_1", submission_id: "sub_123", state: "completed", name: "Jane", email: "jane@example.com", role: "Signer 1", fields: ["signature"], completed_at: "2026-10-27T01:00:00Z" }
    }]
  });
  assert.equal(result.state, "completed");
  assert.equal(result.submissionId, "sub_123");
  assert.deepEqual(result.fields, ["signature"]);
  assert.equal(result.completedAt, "2026-10-27T01:00:00Z");
});
