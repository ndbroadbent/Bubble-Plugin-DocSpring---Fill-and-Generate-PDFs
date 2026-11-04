// Output Formats and the Word document and OpenDocument file results (2.1.0).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, submission, US } = require("./support/harness");

const file = (format, state) => ({
  state: state || "processed",
  error_message: null,
  download_url: `https://downloads.example.com/sub_123.${format}`,
  permanent_url: `https://app.docspring.com/submissions/sub_123/files/${format}`
});
const wordSubmission = (files, overrides) =>
  submission(Object.assign({ output_formats: Object.keys(files), files: files }, overrides || {}));

const WORD_RESULTS = {
  wordFile: "https://downloads.example.com/sub_123.docx",
  permanentWordFile: "https://app.docspring.com/submissions/sub_123/files/docx",
  openDocumentFile: "https://downloads.example.com/sub_123.odt",
  permanentOpenDocumentFile: "https://app.docspring.com/submissions/sub_123/files/odt"
};
const pick = (result, names) => Object.fromEntries(names.map((name) => [name, result[name]]));

test("Create PDF Submission sends Output Formats and returns the Word document and OpenDocument file", async () => {
  const done = wordSubmission({ docx: file("docx"), odt: file("odt") });
  const { result, calls } = await runAction("AAP-850n0", {
    templateId: "tpl_123",
    outputFormats: " DOCX, odt\ndocx "
  }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/submissions?wait=false`, status: 201, body: done }]
  });
  assert.deepEqual(calls[0].json.output_formats, ["docx", "odt"]);
  assert.equal(result.success, true);
  assert.equal(result.file, null);
  assert.equal(result.permanentFile, null);
  assert.deepEqual(pick(result, Object.keys(WORD_RESULTS)), WORD_RESULTS);
});

test("Make Page Images adds png to Output Formats", async () => {
  const done = wordSubmission({ pdf: file("pdf"), png: { state: "processed", pages: [] } });
  const listed = await runAction("AAP-850n0", { templateId: "tpl_123", outputFormats: "docx", makePageImages: true }, {
    responses: [{ method: "POST", status: 201, body: done }]
  });
  assert.deepEqual(listed.calls[0].json.output_formats, ["docx", "png"]);

  const blank = await runAction("AAP-850n0", { templateId: "tpl_123", outputFormats: " ", makePageImages: true }, {
    responses: [{ method: "POST", status: 201, body: done }]
  });
  assert.deepEqual(blank.calls[0].json.output_formats, ["pdf", "png"]);

  const none = await runAction("AAP-850n0", { templateId: "tpl_123", outputFormats: "" }, {
    responses: [{ method: "POST", status: 201, body: done }]
  });
  assert.equal("output_formats" in none.calls[0].json, false);
});

test("Create PDF Submission waits for a file that's still being made, and reports one that failed", async () => {
  const making = wordSubmission({ pdf: file("pdf"), odt: file("odt", "pending") });
  const failed = wordSubmission({
    pdf: file("pdf"),
    odt: Object.assign(file("odt", "error"), { download_url: null, permanent_url: null, error_message: "Conversion failed" })
  });
  const { result } = await runAction("AAP-850n0", { templateId: "tpl_123", outputFormats: "pdf, odt" }, {
    responses: [
      { method: "POST", status: 201, body: making },
      { method: "GET", uri: `${US}/submissions/sub_123`, status: 200, body: failed }
    ]
  });
  assert.equal(result.success, true);
  assert.equal(result.file, "https://downloads.example.com/sub_123.pdf");
  assert.equal(result.openDocumentFile, null);
  assert.equal(
    result.errorMessage,
    "The submission was processed, but not every file could be made.\n" +
      "Its OpenDocument file couldn't be made: Conversion failed\nSubmission: sub_123"
  );
});

test("Get PDF Submission returns the Word document and OpenDocument file", async () => {
  const { result } = await runAction("AAY-850nj", { submissionId: "sub_123" }, {
    responses: [{ method: "GET", status: 200, body: wordSubmission({ docx: file("docx"), odt: file("odt") }) }]
  });
  assert.deepEqual(pick(result, Object.keys(WORD_RESULTS)), WORD_RESULTS);
});

const batch = (submissions) => ({
  id: "sbb_123",
  state: "processed",
  total_count: submissions.length,
  pending_count: 0,
  error_count: 0,
  processed_at: "2026-10-27T00:00:05Z",
  submissions: submissions
});

test("Generate PDFs in a Batch sends Output Formats and returns the files of each submission", async () => {
  const done = batch([wordSubmission({ docx: file("docx") }), submission({ id: "sub_456" })]);
  const { result, calls } = await runAction("generate-pdfs-in-a-batch", {
    submissions: '[{"data": {}}, {"data": {}, "output_formats": ["pdf"]}]',
    templateId: "tpl_123",
    outputFormats: "docx",
    makePageImages: false,
    wait: true
  }, {
    responses: [{ method: "POST", uri: `${US}/submissions/batches?wait=false`, status: 201, body: done }]
  });
  assert.deepEqual(calls[0].json.output_formats, ["docx"]);
  assert.deepEqual(result.files, [null, "https://downloads.example.com/sub_123.pdf"]);
  assert.deepEqual(result.wordFiles, ["https://downloads.example.com/sub_123.docx", null]);
  assert.deepEqual(result.permanentWordFiles, ["https://app.docspring.com/submissions/sub_123/files/docx", null]);
  assert.deepEqual(result.openDocumentFiles, [null, null]);
  assert.deepEqual(result.permanentOpenDocumentFiles, [null, null]);
});

test("Get Submission Batch returns the files of each submission", async () => {
  const { result } = await runAction("get-submission-batch", { batchId: "sbb_123" }, {
    responses: [{ method: "GET", uri: `${US}/submissions/batches/sbb_123`, status: 200, body: batch([wordSubmission({ odt: file("odt") })]) }]
  });
  assert.deepEqual(result.openDocumentFiles, ["https://downloads.example.com/sub_123.odt"]);
  assert.deepEqual(result.permanentOpenDocumentFiles, ["https://app.docspring.com/submissions/sub_123/files/odt"]);
  assert.deepEqual(result.wordFiles, [null]);
});

test("Generate Submission Files makes the Formats and waits for them", async () => {
  const making = wordSubmission({ docx: file("docx"), pdf: file("pdf", "pending"), odt: file("odt", "pending") });
  const made = wordSubmission({ docx: file("docx"), pdf: file("pdf"), odt: file("odt") });
  const { result, calls } = await runAction("generate-submission-files", { submissionId: "sub_123", formats: "pdf, ODT", wait: true }, {
    responses: [
      { method: "POST", uri: `${US}/submissions/sub_123/generate_files?wait=false`, status: 200, body: making },
      { method: "GET", uri: `${US}/submissions/sub_123`, status: 200, body: made }
    ]
  });
  assert.deepEqual(calls[0].json, { formats: ["pdf", "odt"] });
  assert.equal(result.success, true);
  assert.equal(result.errorMessage, null);
  assert.equal(result.file, "https://downloads.example.com/sub_123.pdf");
  assert.equal(result.permanentFile, "https://app.docspring.com/submissions/sub_123/files/pdf");
  assert.deepEqual(pick(result, Object.keys(WORD_RESULTS)), WORD_RESULTS);
  assert.equal(result.pageImagesState, null);
});

test("Generate Submission Files fails when a format it asked for couldn't be made", async () => {
  const failed = wordSubmission({
    docx: file("docx"),
    pdf: Object.assign(file("pdf", "error"), { download_url: null, permanent_url: null, error_message: "Conversion failed" })
  });
  const { result } = await runAction("generate-submission-files", { submissionId: "sub_123", formats: "png", wait: false }, {
    responses: [{ method: "POST", status: 200, body: failed }]
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMessage, "Its PDF couldn't be made: Conversion failed\nSubmission: sub_123");
});

test("Generate Submission Files says when the files weren't ready in time", async () => {
  const making = wordSubmission({ docx: file("docx"), odt: file("odt", "pending") });
  const responses = [{ method: "POST", status: 200, body: making }];
  for (let i = 0; i < 9; i += 1) responses.push({ method: "GET", status: 200, body: making });
  const { result } = await runAction("generate-submission-files", { submissionId: "sub_123", formats: "odt" }, {
    responses: responses,
    allowUnusedResponses: true
  });
  assert.equal(result.success, false);
  assert.equal(result.id, "sub_123");
  assert.equal(result.errorMessage, "The files weren't ready in time. Get them later with Get PDF Submission (sub_123).");
});
