// Get PDF Submission (actions/AAY-850nj) on API v2.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, submission, v2Error, US } = require("./support/harness");

test("returns the v2 submission under the plugin's return keys", async () => {
  const body = submission();
  const { result } = await runAction("AAY-850nj", { submissionId: "sub_123" }, {
    responses: [{ method: "GET", uri: `${US}/submissions/sub_123`, status: 200, body: body }]
  });
  assert.deepEqual(
    Object.assign({}, result, { regionInfo: undefined, response: undefined }),
    {
      success: true,
      id: "sub_123",
      state: "processed",
      file: "https://downloads.example.com/sub_123.pdf",
      permanentFile: "https://app.docspring.com/submissions/sub_123/files/pdf",
      pageImages: [],
      errorMessage: null,
      processedAt: "2026-10-27T00:00:01Z",
      pdfHash: "abc123",
      templateId: "tpl_123",
      isTest: true,
      expiresAt: "2026-11-27T00:00:00Z",
      password: null,
      regionInfo: undefined,
      response: undefined
    }
  );
  assert.deepEqual(JSON.parse(result.response), body);
});

test("a pending submission has no files yet", async () => {
  const { result } = await runAction("AAY-850nj", { submissionId: "sub_123" }, {
    responses: [{ method: "GET", status: 200, body: submission({ state: "pending", files: {}, processed_at: null }) }]
  });
  assert.equal(result.success, true);
  assert.equal(result.state, "pending");
  assert.equal(result.file, null);
  assert.equal(result.pdfHash, null);
});

test("a failed submission returns its error message", async () => {
  const { result } = await runAction("AAY-850nj", { submissionId: "sub_123" }, {
    responses: [{ method: "GET", status: 200, body: submission({ state: "error", error_message: "Boom", files: {} }) }]
  });
  assert.equal(result.success, true);
  assert.equal(result.errorMessage, "Boom");
});

test("a 404 returns the formatted error", async () => {
  const { result } = await runAction("AAY-850nj", { submissionId: "sub_missing" }, {
    responses: [{ method: "GET", uri: `${US}/submissions/sub_missing`, status: 404, body: v2Error("not_found", "Submission not found") }]
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMessage, "DocSpring API error 404 not_found: Submission not found\nRequest ID: req_123");
});

test("IDs are escaped in the path", async () => {
  await runAction("AAY-850nj", { submissionId: "sub_1/../x" }, {
    responses: [{ method: "GET", uri: `${US}/submissions/sub_1%2F..%2Fx`, status: 200, body: submission() }]
  });
});
