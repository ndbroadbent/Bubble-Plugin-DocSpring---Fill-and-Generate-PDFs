// Region setting, authentication and the request every action sends, through
// Get PDF Submission (a single GET).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, submission, v2Error } = require("./support/harness");

const getWithRegion = (region, uri, response) =>
  runAction("AAY-850nj", { submissionId: "sub_123" }, {
    keys: { Region: region },
    responses: [Object.assign({ method: "GET", uri: uri, status: 200, body: submission() }, response || {})]
  });

const cases = [
  ["", "https://api.docspring.com/api/v2/submissions/sub_123", "US"],
  ["US", "https://api.docspring.com/api/v2/submissions/sub_123", "US"],
  [" us ", "https://api.docspring.com/api/v2/submissions/sub_123", "US"],
  ["EU", "https://api-eu.docspring.com/api/v2/submissions/sub_123", "EU"],
  ["eu", "https://api-eu.docspring.com/api/v2/submissions/sub_123", "EU"],
  // Self-hosted servers: users entered the full base URL with /api/v1.
  ["https://docspring.example.com/api/v1", "https://docspring.example.com/api/v2/submissions/sub_123", "CUSTOM"],
  ["https://docspring.example.com/api/v1/", "https://docspring.example.com/api/v2/submissions/sub_123", "CUSTOM"],
  ["https://docspring.example.com/api/v2", "https://docspring.example.com/api/v2/submissions/sub_123", "CUSTOM"],
  ["https://docspring.example.com", "https://docspring.example.com/api/v2/submissions/sub_123", "CUSTOM"],
  ["https://docspring.example.com/api", "https://docspring.example.com/api/v2/submissions/sub_123", "CUSTOM"],
  ["http://10.0.0.5:3000/api/v1", "http://10.0.0.5:3000/api/v2/submissions/sub_123", "CUSTOM"],
  ["docspring.example.com", "https://docspring.example.com/api/v2/submissions/sub_123", "CUSTOM"],
  ["https://pdfs.example.com/docspring/api/v1", "https://pdfs.example.com/docspring/api/v2/submissions/sub_123", "CUSTOM"],
  // DocSpring's own hosts entered as URLs map to their region.
  ["https://api-eu.docspring.com/api/v1", "https://api-eu.docspring.com/api/v2/submissions/sub_123", "EU"],
  ["https://sync.api.docspring.com/api/v1", "https://api.docspring.com/api/v2/submissions/sub_123", "US"]
];

cases.forEach(([region, uri, expectedRegion]) => {
  test(`Region ${JSON.stringify(region)} calls ${uri}`, async () => {
    const { result } = await getWithRegion(region, uri);
    assert.equal(result.success, true);
    const info = JSON.parse(result.regionInfo);
    assert.equal(info.region, expectedRegion);
    assert.equal(info.usedFallback, false);
  });
});

test("an unreadable Region falls back to US with a warning", async () => {
  const { result } = await getWithRegion("Europe", "https://api.docspring.com/api/v2/submissions/sub_123");
  const info = JSON.parse(result.regionInfo);
  assert.equal(info.region, "US");
  assert.equal(info.usedFallback, true);
  assert.match(info.warningMessage, /Invalid Region setting "Europe"/);
});

test("the AU region is an error saying it has closed", async () => {
  for (const region of ["AU", "au", "https://api-au.docspring.com/api/v1"]) {
    await assert.rejects(
      runAction("AAY-850nj", { submissionId: "sub_123" }, { keys: { Region: region } }),
      /The AU region has closed/
    );
  }
});

test("missing API token settings are an error", async () => {
  await assert.rejects(
    runAction("AAY-850nj", { submissionId: "sub_123" }, { keys: { "Token Secret": "" } }),
    /fill in the 'Token ID' and 'Token Secret' fields/
  );
});

test("requests use HTTP Basic auth, JSON and the plugin's User-Agent", async () => {
  const { calls } = await runAction("AAY-850nj", { submissionId: " sub_123 " }, {
    keys: { "Token ID": " token_id\n", "Token Secret": "Bearer token_secret" },
    responses: [{ method: "GET", uri: "https://api.docspring.com/api/v2/submissions/sub_123", status: 200, body: submission() }]
  });
  assert.deepEqual(calls[0].auth, { user: "token_id", pass: "token_secret" });
  assert.equal(calls[0].headers["User-Agent"], "docspring-bubble/2.0.0");
  assert.equal(calls[0].json, true);
  assert.equal(calls[0].simple, false);
});

test("a 404 without an API v2 error from a self-hosted server says it needs API v2", async () => {
  const { result } = await getWithRegion("https://docspring.example.com/api/v1", "https://docspring.example.com/api/v2/submissions/sub_123", {
    status: 404,
    body: "<html>Not Found</html>"
  });
  assert.equal(result.success, false);
  assert.equal(
    result.errorMessage,
    "This DocSpring server doesn't have API v2 yet. Upgrade it to the latest release, or use version 1.7.0 of this plugin."
  );
});

test("a self-hosted server's API v2 404 is shown as an API error", async () => {
  const { result } = await getWithRegion("https://docspring.example.com", "https://docspring.example.com/api/v2/submissions/sub_123", {
    status: 404,
    body: v2Error("not_found", "Submission not found")
  });
  assert.equal(result.errorMessage, "DocSpring API error 404 not_found: Submission not found\nRequest ID: req_123");
});

test("a request library that rejects on HTTP errors is handled like a response", async () => {
  const error = Object.assign(new Error("404 - not found"), {
    statusCode: 404,
    error: v2Error("not_found", "Submission not found")
  });
  const { result } = await runAction("AAY-850nj", { submissionId: "sub_123" }, {
    responses: [{ method: "GET", throws: error }]
  });
  assert.equal(result.success, false);
  assert.match(result.errorMessage, /^DocSpring API error 404 not_found: Submission not found/);
});

test("a network failure names the URL", async () => {
  const { result } = await runAction("AAY-850nj", { submissionId: "sub_123" }, {
    responses: [{ method: "GET", throws: new Error("getaddrinfo ENOTFOUND") }]
  });
  assert.equal(result.success, false);
  assert.equal(
    result.errorMessage,
    "Could not reach DocSpring at https://api.docspring.com/api/v2/submissions/sub_123: getaddrinfo ENOTFOUND"
  );
});
