// New submission, batch and combined PDF actions .
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, submission, v2Error, US } = require("./support/harness");

const batch = (overrides) =>
  Object.assign(
    {
      id: "sbb_123",
      state: "processed",
      total_count: 2,
      pending_count: 0,
      error_count: 0,
      processed_at: "2026-10-27T00:00:05Z",
      submissions: [submission(), submission({ id: "sub_456" })]
    },
    overrides || {}
  );

test("Generate PDFs in a Batch posts the batch with wait=false and polls until it has finished", async () => {
  const { result, calls } = await runAction("generate-pdfs-in-a-batch", {
    submissions: '[{"data": {"name": "Jane"}}, {"data": {"name": "Joe"}, "template_id": "tpl_456"}]',
    templateId: "tpl_123",
    version: "draft",
    test: true,
    metadata: [{ key: "run", value: "7" }],
    makePageImages: false,
    wait: true
  }, {
    responses: [
      { method: "POST", uri: `${US}/submissions/batches?wait=false`, status: 201, body: batch({ state: "pending", processed_at: null }) },
      { method: "GET", uri: `${US}/submissions/batches/sbb_123`, status: 200, body: batch() }
    ]
  });
  assert.deepEqual(calls[0].json, {
    submissions: [{ data: { name: "Jane" } }, { data: { name: "Joe" }, template_id: "tpl_456" }],
    template_id: "tpl_123",
    template_version: "draft",
    test: true,
    metadata: { run: "7" }
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.submissionIds, ["sub_123", "sub_456"]);
  assert.deepEqual(result.submissionStates, ["processed", "processed"]);
  assert.deepEqual(result.files, ["https://downloads.example.com/sub_123.pdf", "https://downloads.example.com/sub_123.pdf"]);
});

test("Generate PDFs in a Batch stops on a 429 it can't wait for, naming the batch", async () => {
  const { result, sleeps } = await runAction("generate-pdfs-in-a-batch", { submissions: '[{"data": {}}]', templateId: "tpl_123", wait: true }, {
    responses: [
      { method: "POST", status: 201, body: batch({ state: "pending", processed_at: null, pending_count: 2 }) },
      { method: "GET", uri: `${US}/submissions/batches/sbb_123`, status: 429, headers: { "retry-after": "50" }, body: v2Error("rate_limited", "Slow down") }
    ]
  });
  assert.deepEqual(sleeps, [1000]);
  assert.equal(result.success, false);
  assert.equal(result.id, "sbb_123");
  assert.equal(
    result.errorMessage,
    "The batch wasn't ready in time. Get it later with Get Submission Batch (sbb_123), or create a webhook for the submission_batch.processed event."
  );
});

test("Generate PDFs in a Batch reports a failed batch, and needs a JSON list", async () => {
  const failed = batch({
    state: "error",
    error_count: 1,
    submissions: [submission(), submission({ id: "sub_456", state: "error", error_message: "Boom", files: {} })]
  });
  const { result } = await runAction("generate-pdfs-in-a-batch", { submissions: [{ data: {} }], wait: false }, {
    responses: [{ method: "POST", uri: `${US}/submissions/batches?wait=false`, status: 201, body: failed }]
  });
  assert.equal(result.success, false);
  assert.equal(
    result.errorMessage,
    "1 of 2 PDFs in the batch couldn't be generated (state: error).\nSubmission batch: sbb_123\nFirst failure: sub_456 (state: error): Boom"
  );
  await assert.rejects(runAction("generate-pdfs-in-a-batch", { submissions: '{"data": {}}' }), /must be a JSON array/);
  await assert.rejects(runAction("generate-pdfs-in-a-batch", { submissions: "" }), /Submissions \(JSON\) is required/);
});

test("Get Submission Batch", async () => {
  const { result } = await runAction("get-submission-batch", { batchId: "sbb_123", includeData: true }, {
    responses: [{ method: "GET", uri: `${US}/submissions/batches/sbb_123?include_data=true`, status: 200, body: batch() }]
  });
  assert.equal(result.success, true);
  assert.equal(result.state, "processed");
  assert.deepEqual(result.submissionIds, ["sub_123", "sub_456"]);
});

test("Check Data posts to validate and returns valid and the errors", async () => {
  const invalid = {
    valid: false,
    template_id: "tpl_123",
    template_version: null,
    error: v2Error("invalid_data", "The data doesn't match the template's fields", {
      details: [{ code: "required", message: "is required", pointer: "/data/last_name" }]
    }).error
  };
  const { result, calls } = await runAction("check-data", {
    templateId: "tpl_123",
    version: "draft",
    data: [{ key: "first_name", value: "Jane" }],
    test: false
  }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/submissions/validate?version=draft`, status: 200, body: invalid }]
  });
  assert.deepEqual(calls[0].json, { data: { first_name: "Jane" } });
  assert.equal(result.success, true);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["/data/last_name: is required"]);
  assert.equal(
    result.errorMessage,
    "invalid_data: The data doesn't match the template's fields\n/data/last_name: is required\nRequest ID: req_123"
  );

  const valid = await runAction("check-data", {
    templateId: "tpl_123",
    signatureRequests: '[{"fields": ["signature"], "auth_type": "email_link"}]'
  }, {
    responses: [{ method: "POST", status: 200, body: { valid: true, template_id: "tpl_123", template_version: null } }]
  });
  assert.deepEqual(valid.calls[0].json, { signature_requests: [{ fields: ["signature"], auth_type: "email_link" }] });
  assert.equal(valid.result.valid, true);
  assert.deepEqual(valid.result.errors, []);
});

test("Find Submissions lists a template's submissions with filters", async () => {
  const { result } = await runAction("find-submissions", {
    templateId: "tpl_123",
    testFilter: "live",
    createdAfter: new Date("2026-10-01T00:00:00Z"),
    createdBefore: Date.parse("2026-10-27T00:00:00Z"),
    includeData: true,
    limit: 10,
    cursor: "sub_100"
  }, {
    responses: [{
      method: "GET",
      uri: `${US}/templates/tpl_123/submissions?test=false&created_after=2026-10-01T00%3A00%3A00.000Z` +
        "&created_before=2026-10-27T00%3A00%3A00.000Z&include_data=true&limit=10&cursor=sub_100",
      status: 200,
      body: { data: [submission(), submission({ id: "sub_456", state: "pending", files: {} })], next_cursor: "sub_456" }
    }]
  });
  assert.deepEqual(result.ids, ["sub_123", "sub_456"]);
  assert.deepEqual(result.states, ["processed", "pending"]);
  assert.deepEqual(result.files, ["https://downloads.example.com/sub_123.pdf", null]);
  assert.equal(result.nextCursor, "sub_456");
});

test("Find Submissions without a template lists every submission", async () => {
  const { result } = await runAction("find-submissions", { testFilter: "any" }, {
    responses: [{ method: "GET", uri: `${US}/submissions`, status: 200, body: { data: [], next_cursor: null } }]
  });
  assert.deepEqual(result.ids, []);
  assert.equal(result.nextCursor, null);
  await assert.rejects(runAction("find-submissions", { testFilter: "both" }), /Test or Live must be any, live or test/);
  await assert.rejects(runAction("find-submissions", { createdAfter: "last week" }), /Created After must be a date/);
});

test("Generate Submission Files asks for png and waits for the images", async () => {
  const making = submission({ files: { pdf: submission().files.pdf, png: { state: "pending", pages: [] } } });
  const made = submission({ files: { pdf: submission().files.pdf, png: { state: "processed", pages: [{ download_url: "https://img/1.png" }] } } });
  const { result, calls } = await runAction("generate-submission-files", { submissionId: "sub_123", wait: true }, {
    responses: [
      { method: "POST", uri: `${US}/submissions/sub_123/generate_files?wait=false`, status: 200, body: making },
      { method: "GET", uri: `${US}/submissions/sub_123`, status: 200, body: made }
    ]
  });
  assert.deepEqual(calls[0].json, { formats: ["png"] });
  assert.equal(result.success, true);
  assert.equal(result.pageImagesState, "processed");
  assert.deepEqual(result.pageImages, ["https://img/1.png"]);
});

test("Expire Submission deletes it", async () => {
  const { result } = await runAction("expire-submission", { submissionId: "sub_123" }, {
    responses: [{ method: "DELETE", uri: `${US}/submissions/sub_123`, status: 200, body: submission({ expired: true, files: {} }) }]
  });
  assert.equal(result.success, true);
  assert.equal(result.expired, true);
});

test("Combine PDFs builds typed sources, fixes protocol-relative URLs, and polls", async () => {
  const combined = (state) => ({
    id: "com_123",
    state: state,
    error_message: null,
    files: state === "processed" ? { pdf: { download_url: "https://downloads.example.com/com_123.pdf", permanent_url: "https://app/com_123" } } : {}
  });
  const { result, calls } = await runAction("combine-pdfs", {
    sources: [
      { key: "submission", value: "sub_123" },
      { key: "Combined PDF", value: "com_000" },
      { key: "url", value: "//s3.amazonaws.com/appforest_uf/cover.pdf" }
    ],
    sourcesJson: '[{"type": "template", "id": "tpl_123", "template_version": "1.2.0"}]',
    metadata: [{ key: "order", value: "A1" }],
    password: "pw",
    expiresIn: 600,
    wait: true
  }, {
    responses: [
      { method: "POST", uri: `${US}/combined_pdfs?wait=false`, status: 201, body: combined("pending") },
      { method: "GET", uri: `${US}/combined_pdfs/com_123`, status: 200, body: combined("processed") }
    ]
  });
  assert.deepEqual(calls[0].json, {
    source_pdfs: [
      { type: "submission", id: "sub_123" },
      { type: "combined_pdf", id: "com_000" },
      { type: "url", url: "https://s3.amazonaws.com/appforest_uf/cover.pdf" },
      { type: "template", id: "tpl_123", template_version: "1.2.0" }
    ],
    metadata: { order: "A1" },
    password: "pw",
    expires_in: 600
  });
  assert.equal(result.success, true);
  assert.equal(result.file, "https://downloads.example.com/com_123.pdf");
  await assert.rejects(runAction("combine-pdfs", { sources: [{ key: "pdf", value: "x" }] }), /"pdf" isn't a source type/);
  await assert.rejects(runAction("combine-pdfs", {}), /Add at least one PDF/);
});

test("Combine PDFs reports a failed combined PDF", async () => {
  const { result } = await runAction("combine-pdfs", { sources: [{ key: "submission", value: "sub_123" }], wait: false }, {
    responses: [{ method: "POST", status: 201, body: { id: "com_123", state: "error", error_message: "Not a PDF", files: {} } }]
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMessage, "The combined PDF couldn't be generated (state: error): Not a PDF\nCombined PDF: com_123");
});

test("Get Combined PDF", async () => {
  const { result } = await runAction("get-combined-pdf", { combinedPdfId: "com_123" }, {
    responses: [{
      method: "GET",
      uri: `${US}/combined_pdfs/com_123`,
      status: 200,
      body: { id: "com_123", state: "processed", expires_at: null, files: { pdf: { download_url: "https://d/com.pdf", permanent_url: "https://p/com" } } }
    }]
  });
  assert.equal(result.file, "https://d/com.pdf");
  assert.equal(result.permanentFile, "https://p/com");
});
