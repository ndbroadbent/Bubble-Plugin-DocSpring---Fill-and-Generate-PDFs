// Who emails the signers (Emails to Signers), DocSpring's email options, the
// signing order and steps: Create Signature Request and Check Data (2.1.0).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, submission, US } = require("./support/harness");

const CREATE_URI = `${US}/templates/tpl_123/submissions`;
const VALIDATE_URI = `${US}/templates/tpl_123/submissions/validate`;

// The submission the API returns, with each signature request's send_email.
const created = (...sendEmails) =>
  submission({
    state: "waiting_for_signature_requests",
    files: {},
    processed_at: null,
    signature_requests: sendEmails.map((sendEmail, index) => ({
      id: `srq_${index + 1}`,
      state: "pending",
      send_email: sendEmail
    }))
  });
const token = (url) => ({ id: "tok_1", type: "email", signature_request_url: url, expires_at: "2026-11-11T00:00:00Z" });

const EMAIL_OPTIONS = {
  emailSubject: "  Please sign the lease ",
  emailMessage: "Please sign by Friday.",
  cc: "records@example.com, , ops@example.com\nrecords@example.com",
  reminderIntervalDays: 3,
  reminderMaxCount: "2",
  replyTo: "legal@example.com",
  notificationEmails: ["ops@example.com", " ops@example.com ", ""],
  notifyWhenSigned: true
};
const EMAIL_SETTINGS = {
  email_subject: "Please sign the lease",
  email_message: "Please sign by Friday.",
  cc: ["records@example.com", "ops@example.com"],
  reminders: { interval_days: 3, max_count: 2 },
  reply_to: "legal@example.com",
  notification_emails: ["ops@example.com"],
  notify_when_signed: true
};

test("Create Signature Request lets DocSpring email the signers by default, and makes no links", async () => {
  // The harness fails on any request not listed: no token is asked for.
  const { result, calls } = await runAction("create-signature-request", {
    templateId: "tpl_123",
    signerName: "Jane Doe",
    signerEmail: " jane@example.com ",
    signerFields: "signature",
    signingLinkType: "api"
  }, {
    responses: [{ method: "POST", uri: CREATE_URI, status: 201, body: created(true) }]
  });
  assert.deepEqual(calls[0].json, {
    signature_requests: [{ fields: ["signature"], auth_type: "email_link", name: "Jane Doe", email: "jane@example.com" }],
    send_email: true
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.signatureRequestIds, ["srq_1"]);
  assert.deepEqual(result.signingUrls, [null]);
  assert.equal(result.firstSigningUrl, null);
});

test("Create Signature Request sends DocSpring's email options, the signing order and step", async () => {
  const { calls } = await runAction("create-signature-request", Object.assign({
    templateId: "tpl_123",
    signerEmail: "jane@example.com",
    signerFields: "signature",
    signerSigningStep: "2",
    signatureRequests: '[{"email": "joe@example.com", "fields": ["signature_2"], "signing_step": 1}]',
    sendEmail: "docspring",
    signingOrder: "sequential"
  }, EMAIL_OPTIONS), {
    responses: [{ method: "POST", uri: CREATE_URI, status: 201, body: created(true, true) }]
  });
  assert.deepEqual(calls[0].json, Object.assign({
    signature_requests: [
      { fields: ["signature"], auth_type: "email_link", email: "jane@example.com", signing_step: 2 },
      { email: "joe@example.com", fields: ["signature_2"], signing_step: 1, auth_type: "email_link" }
    ],
    send_email: true,
    signing_order: "sequential"
  }, EMAIL_SETTINGS));
});

test("Create Signature Request leaves out blank email options, and needs both reminder values", async () => {
  const { calls } = await runAction("create-signature-request", {
    templateId: "tpl_123",
    signerFields: "signature",
    emailSubject: " ",
    cc: "",
    reminderIntervalDays: 3,
    notifyWhenSigned: false
  }, {
    responses: [{ method: "POST", status: 201, body: created(true) }]
  });
  // One reminder value alone is the API's error to report, which names the other.
  assert.deepEqual(calls[0].json, {
    signature_requests: [{ fields: ["signature"], auth_type: "email_link" }],
    send_email: true,
    reminders: { interval_days: 3 }
  });
  await assert.rejects(
    runAction("create-signature-request", { templateId: "tpl_123", signerFields: "signature", reminderMaxCount: "two" }),
    /Most Reminders per Person must be a whole number/
  );
  await assert.rejects(
    runAction("create-signature-request", { templateId: "tpl_123", signerFields: "signature", sendEmail: "me" }),
    /Emails to Signers must be docspring or self, not "me"/
  );
});

test("Create Signature Request with self sends no email options and makes a link for each signer", async () => {
  const { result, calls } = await runAction("create-signature-request", Object.assign({
    templateId: "tpl_123",
    signerFields: "signature",
    signatureRequests: '[{"fields": ["signature_2"], "auth_type": "password", "email": ""}]',
    sendEmail: "self",
    signingOrder: "parallel",
    signingLinkType: "email"
  }, EMAIL_OPTIONS), {
    responses: [
      { method: "POST", uri: CREATE_URI, status: 201, body: created(false, false) },
      { method: "POST", uri: `${US}/signature_requests/srq_1/tokens`, status: 201, body: token("https://sign/1") },
      { method: "POST", uri: `${US}/signature_requests/srq_2/tokens`, status: 201, body: token("https://sign/2") }
    ]
  });
  assert.deepEqual(calls[0].json, {
    signature_requests: [
      { fields: ["signature"], auth_type: "email_link" },
      { fields: ["signature_2"], auth_type: "password" }
    ],
    send_email: false,
    signing_order: "parallel"
  });
  assert.deepEqual(calls[1].json, { type: "email" });
  assert.deepEqual(result.signingUrls, ["https://sign/1", "https://sign/2"]);
});

test("Create Signature Request makes a link only for a More Signers item that DocSpring doesn't email", async () => {
  const { result, calls } = await runAction("create-signature-request", {
    templateId: "tpl_123",
    signerEmail: "jane@example.com",
    signerFields: "signature",
    signatureRequests: '[{"fields": ["signature_2"], "send_email": false}]'
  }, {
    responses: [
      { method: "POST", uri: CREATE_URI, status: 201, body: created(true, false) },
      { method: "POST", uri: `${US}/signature_requests/srq_2/tokens`, status: 201, body: token("https://sign/2") }
    ]
  });
  assert.deepEqual(calls[0].json.signature_requests[1], { fields: ["signature_2"], send_email: false, auth_type: "email_link" });
  assert.deepEqual(calls[1].json, { type: "api" });
  assert.equal(result.success, true);
  assert.deepEqual(result.signingUrls, [null, "https://sign/2"]);
  assert.equal(result.firstSigningUrl, null);
});

test("Check Data checks the signers with the same email settings", async () => {
  const valid = { valid: true, template_id: "tpl_123", template_version: null };
  const { calls } = await runAction("check-data", Object.assign({
    templateId: "tpl_123",
    signatureRequests: '[{"email": " jane@example.com ", "name": "", "fields": ["signature"], "signing_step": 1}]',
    signingOrder: "sequential"
  }, EMAIL_OPTIONS), {
    responses: [{ method: "POST", uri: VALIDATE_URI, status: 200, body: valid }]
  });
  assert.deepEqual(calls[0].json, Object.assign({
    signature_requests: [{ email: "jane@example.com", fields: ["signature"], signing_step: 1, auth_type: "email_link" }],
    send_email: true,
    signing_order: "sequential"
  }, EMAIL_SETTINGS));

  const self = await runAction("check-data", Object.assign({
    templateId: "tpl_123",
    signatureRequests: '[{"fields": ["signature"], "auth_type": "password"}]',
    sendEmail: "self"
  }, EMAIL_OPTIONS), {
    responses: [{ method: "POST", uri: VALIDATE_URI, status: 200, body: valid }]
  });
  assert.deepEqual(self.calls[0].json, {
    signature_requests: [{ fields: ["signature"], auth_type: "password" }],
    send_email: false
  });

  // Without signers, the email settings aren't sent: the API refuses them.
  const dataOnly = await runAction("check-data", Object.assign({
    templateId: "tpl_123",
    data: [{ key: "name", value: "Jane" }],
    sendEmail: "self",
    signingOrder: "sequential"
  }, EMAIL_OPTIONS), {
    responses: [{ method: "POST", uri: VALIDATE_URI, status: 200, body: valid }]
  });
  assert.deepEqual(dataOnly.calls[0].json, { data: { name: "Jane" } });
});
