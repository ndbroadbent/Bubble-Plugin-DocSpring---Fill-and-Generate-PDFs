// Create PDF Submission (actions/AAP-850n0) on API v2.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, submission, v2Error, US } = require("./support/harness");

const ACTION = "AAP-850n0";
const CREATE_URI = `${US}/templates/tpl_123/submissions?wait=false`;
const GET_URI = `${US}/submissions/sub_123`;
const pending = () => submission({ state: "pending", files: {}, processed_at: null });

test("creates a submission with wait=false, polls until it's processed, and returns its files", async () => {
  const { result, calls, sleeps } = await runAction(ACTION, {
    templateId: "tpl_123",
    data: [{ key: "first_name", value: "Jane" }],
    test: true,
    metadata: [{ key: "user_id", value: "42" }]
  }, {
    responses: [
      { method: "POST", uri: CREATE_URI, status: 201, body: pending() },
      { method: "GET", uri: GET_URI, status: 200, body: pending() },
      { method: "GET", uri: GET_URI, status: 200, body: submission() }
    ]
  });

  assert.deepEqual(calls[0].json, { data: { first_name: "Jane" }, test: true, metadata: { user_id: "42" } });
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.equal(result.success, true);
  assert.equal(result.id, "sub_123");
  assert.equal(result.state, "processed");
  assert.equal(result.file, "https://downloads.example.com/sub_123.pdf");
  assert.equal(result.permanentFile, "https://app.docspring.com/submissions/sub_123/files/pdf");
  assert.equal(result.errorMessage, null);
  assert.deepEqual(JSON.parse(result.response), submission());
  assert.equal(JSON.parse(result.regionInfo).apiBaseUrl, US);
});

test("sends test only when it's true", async () => {
  for (const value of [false, "false", undefined, null]) {
    const { calls } = await runAction(ACTION, { templateId: "tpl_123", test: value }, {
      responses: [{ method: "POST", uri: CREATE_URI, status: 201, body: submission() }]
    });
    assert.ok(!("test" in calls[0].json), `test: ${value} was sent`);
  }
  const { calls } = await runAction(ACTION, { templateId: "tpl_123", test: "true" }, {
    responses: [{ method: "POST", uri: CREATE_URI, status: 201, body: submission() }]
  });
  assert.equal(calls[0].json.test, true);
});

test("sends the new optional fields, typed, and leaves out blank ones", async () => {
  const { calls } = await runAction(ACTION, {
    templateId: "tpl_123",
    version: "1.2.0",
    makePageImages: true,
    password: "s3cret",
    expiresIn: "3600",
    fieldOverrides: '{"name": {"required": false}}',
    metadata: []
  }, {
    responses: [{
      method: "POST",
      uri: `${US}/templates/tpl_123/submissions?version=1.2.0&wait=false`,
      status: 201,
      body: submission({ files: { pdf: submission().files.pdf, png: { state: "processed", pages: [{ download_url: "https://img/1.png" }] } } })
    }]
  });
  assert.deepEqual(calls[0].json, {
    data: {},
    output_formats: ["pdf", "png"],
    password: "s3cret",
    expires_in: 3600,
    field_overrides: { name: { required: false } }
  });
});

test("sends Editable as a boolean, and leaves it out when blank", async () => {
  const cases = [[true, true], ["yes", true], ["true", true], [false, false], ["no", false], [undefined, undefined], [null, undefined], ["", undefined]];
  for (const [editable, sent] of cases) {
    const { calls } = await runAction(ACTION, { templateId: "tpl_123", editable: editable }, {
      responses: [{ method: "POST", uri: CREATE_URI, status: 201, body: submission() }]
    });
    assert.equal(calls[0].json.editable, sent, `Editable ${JSON.stringify(editable)}`);
    assert.equal("editable" in calls[0].json, sent !== undefined, `Editable ${JSON.stringify(editable)}`);
  }
  await assert.rejects(runAction(ACTION, { templateId: "tpl_123", editable: "maybe" }), /Editable must be yes or no/);
});

test("rejects values that can't convert", async () => {
  await assert.rejects(runAction(ACTION, { templateId: "tpl_123", expiresIn: "an hour" }), /Expires In \(Seconds\) must be a whole number/);
  await assert.rejects(runAction(ACTION, { templateId: "tpl_123", fieldOverrides: "{nope" }), /Field Overrides \(JSON\) isn't valid JSON/);
  await assert.rejects(runAction(ACTION, { templateId: "tpl_123", fieldOverrides: "[]" }), /must be a JSON object/);
});

test("a blank template ID returns Success = no, as 1.7.0 did, without a request", async () => {
  for (const templateId of ["", "  ", null, undefined]) {
    const { result, calls } = await runAction(ACTION, { templateId: templateId, data: [] });
    assert.equal(calls.length, 0);
    assert.equal(result.success, false);
    assert.equal(result.errorMessage, "Template ID is required.");
    assert.equal(result.response, null);
    assert.equal(JSON.parse(result.regionInfo).apiBaseUrl, US);
  }
  const { result } = await runAction(ACTION, { templateId: " .. " });
  assert.equal(result.success, false);
  assert.equal(result.errorMessage, 'Template ID can\'t be "..".');
});

test("builds nested data from a/b/0 keys, parses booleans, and fixes protocol-relative image URLs", async () => {
  const { calls } = await runAction(ACTION, {
    templateId: "tpl_123",
    parseAsBoolean: true,
    data: [
      { key: "address/city", value: "Auckland" },
      { key: "items/0/name", value: "Widget" },
      { key: "items/1/name", value: "Gadget" },
      { key: "agree", value: "true" },
      { key: "logo/url", value: "//s3.amazonaws.com/appforest_uf/logo.png" },
      { key: "note", value: "//not a url field" },
      { key: "", value: "ignored" }
    ]
  }, { responses: [{ method: "POST", uri: CREATE_URI, status: 201, body: submission() }] });
  assert.deepEqual(calls[0].json.data, {
    address: { city: "Auckland" },
    items: [{ name: "Widget" }, { name: "Gadget" }],
    agree: true,
    logo: { url: "https://s3.amazonaws.com/appforest_uf/logo.png" },
    note: "//not a url field"
  });
});

test("an invalid data path is an error", async () => {
  await assert.rejects(
    runAction(ACTION, { templateId: "tpl_123", data: [{ key: "a", value: "x" }, { key: "a/0", value: "y" }] }),
    /Invalid data path "a\/0": expected array at "a"/
  );
});

test("a 422 invalid_data returns the formatted error and the recorded submission", async () => {
  const body = v2Error("invalid_data", "The data doesn't match the template's fields: /data/last_name is required", {
    details: [
      { code: "required", message: "is required", pointer: "/data/last_name" },
      { code: "format", message: "must be a date (YYYY-MM-DD)", pointer: "/data/dob" }
    ],
    submission_id: "sub_456"
  });
  const { result } = await runAction(ACTION, { templateId: "tpl_123" }, {
    responses: [{ method: "POST", uri: CREATE_URI, status: 422, body: body }]
  });
  assert.equal(result.success, false);
  assert.equal(
    result.errorMessage,
    [
      "DocSpring API error 422 invalid_data: The data doesn't match the template's fields: /data/last_name is required",
      "/data/last_name: is required",
      "/data/dob: must be a date (YYYY-MM-DD)",
      "Submission: sub_456",
      "Request ID: req_123"
    ].join("\n")
  );
  assert.equal(result.id, "sub_456");
  assert.equal(result.state, "invalid_data");
  assert.deepEqual(JSON.parse(result.response), body);
  assert.ok(result.regionInfo);
});

test("a 422 about the request names the parameter", async () => {
  const body = v2Error("validation_failed", "Invalid request", {
    details: [{ code: "pattern", message: "must be a version like 1.2.3 or 1, or latest or draft", parameter: "version" }]
  });
  const { result } = await runAction(ACTION, { templateId: "tpl_123", version: "v1" }, {
    responses: [{ method: "POST", status: 422, body: body }]
  });
  assert.equal(
    result.errorMessage,
    "DocSpring API error 422 validation_failed: Invalid request\nversion: must be a version like 1.2.3 or 1, or latest or draft\nRequest ID: req_123"
  );
  assert.equal(result.id, undefined);
});

test("a 201 with state error is a failure naming the state, message and submission", async () => {
  const failed = submission({ state: "error", error_message: "Liquid syntax error", files: {}, processed_at: null });
  const { result } = await runAction(ACTION, { templateId: "tpl_123" }, {
    responses: [{ method: "POST", uri: CREATE_URI, status: 201, body: failed }]
  });
  assert.equal(result.success, false);
  assert.equal(result.state, "error");
  assert.equal(result.errorMessage, "The PDF couldn't be generated (state: error): Liquid syntax error\nSubmission: sub_123");
  assert.equal(result.file, null);
});

test("a submission that fails while polling is a failure", async () => {
  const { result } = await runAction(ACTION, { templateId: "tpl_123" }, {
    responses: [
      { method: "POST", uri: CREATE_URI, status: 201, body: pending() },
      { method: "GET", uri: GET_URI, status: 200, body: submission({ state: "image_download_failed", error_message: "Couldn't download logo", files: {} }) }
    ]
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMessage, "The PDF couldn't be generated (state: image_download_failed): Couldn't download logo\nSubmission: sub_123");
});

test("gives up after 45 polls with a message saying how to get the PDF later", async () => {
  const responses = [{ method: "POST", uri: CREATE_URI, status: 201, body: pending() }];
  for (let i = 0; i < 45; i += 1) responses.push({ method: "GET", uri: GET_URI, status: 200, body: pending() });
  const { result, sleeps } = await runAction(ACTION, { templateId: "tpl_123" }, { responses: responses });
  assert.equal(sleeps.length, 45);
  assert.equal(result.success, false);
  assert.equal(result.id, "sub_123");
  assert.equal(result.state, "pending");
  assert.equal(
    result.errorMessage,
    "The PDF wasn't ready in time. Get it later with Get PDF Submission (sub_123), or create a webhook for the submission.processed event."
  );
});

test("a polling response that isn't a submission is an error", async () => {
  const { result } = await runAction(ACTION, { templateId: "tpl_123" }, {
    responses: [
      { method: "POST", uri: CREATE_URI, status: 201, body: pending() },
      { method: "GET", uri: GET_URI, status: 200, body: "<html>Down for maintenance</html>" }
    ]
  });
  assert.equal(result.success, false);
  assert.equal(result.id, "sub_123");
  assert.equal(
    result.errorMessage,
    "DocSpring sent an unexpected response to GET /submissions/sub_123: <html>Down for maintenance</html>"
  );
});

test("waits for page images and returns them", async () => {
  const processing = submission({ files: { pdf: submission().files.pdf, png: { state: "pending", pages: [] } } });
  const done = submission({
    files: {
      pdf: submission().files.pdf,
      png: { state: "processed", pages: [{ download_url: "https://img/1.png" }, { download_url: "https://img/2.png" }] }
    }
  });
  const { result } = await runAction(ACTION, { templateId: "tpl_123", makePageImages: true }, {
    responses: [
      { method: "POST", uri: CREATE_URI, status: 201, body: processing },
      { method: "GET", uri: GET_URI, status: 200, body: done }
    ]
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.pageImages, ["https://img/1.png", "https://img/2.png"]);
});

test("a JSON string body (no json parsing in the request library) is read", async () => {
  const { result } = await runAction(ACTION, { templateId: "tpl_123" }, {
    responses: [{ method: "POST", uri: CREATE_URI, status: 201, body: JSON.stringify(submission()) }]
  });
  assert.equal(result.success, true);
  assert.equal(result.file, "https://downloads.example.com/sub_123.pdf");
});

test("an error without the API v2 shape never prints [object Object]", async () => {
  const { result } = await runAction(ACTION, { templateId: "tpl_123" }, {
    responses: [{ method: "POST", uri: CREATE_URI, status: 502, body: { message: "Bad gateway" } }]
  });
  assert.equal(result.errorMessage, 'DocSpring API error 502: {"message":"Bad gateway"}');
});
