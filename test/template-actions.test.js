// New template, field and folder actions (actions/_new).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, v2Error, US } = require("./support/harness");

const template = (documentState, overrides) =>
  Object.assign(
    {
      id: "tpl_123",
      name: "Contract",
      template_type: "pdf",
      ready: documentState === "processed",
      document: documentState ? { state: documentState, error_message: null, download_url: "https://d/tpl.pdf" } : null,
      parent_folder_id: "fld_1",
      path: "/Contracts",
      latest_version: "1.0.0"
    },
    overrides || {}
  );

test("Find Templates", async () => {
  const { result } = await runAction("_new/find-templates", { query: "Contract", folderId: "fld_1", limit: "25", cursor: "" }, {
    responses: [{
      method: "GET",
      uri: `${US}/templates?query=Contract&parent_folder_id=fld_1&limit=25`,
      status: 200,
      body: { data: [template("processed"), template(null, { id: "tpl_456", name: null, template_type: "html" })], next_cursor: null }
    }]
  });
  assert.deepEqual(result.ids, ["tpl_123", "tpl_456"]);
  assert.deepEqual(result.names, ["Contract", null]);
  assert.deepEqual(result.templateTypes, ["pdf", "html"]);
  await assert.rejects(runAction("_new/find-templates", { limit: "ten" }), /Limit must be a whole number/);
});

test("Get Template", async () => {
  const { result } = await runAction("_new/get-template", { templateId: "tpl_123" }, {
    responses: [{ method: "GET", uri: `${US}/templates/tpl_123`, status: 200, body: template("processed") }]
  });
  assert.equal(result.ready, true);
  assert.equal(result.documentState, "processed");
  assert.equal(result.documentFile, "https://d/tpl.pdf");
  assert.equal(result.folderId, "fld_1");
});

test("Create Template from a Bubble file with field detection, waiting for the PDF", async () => {
  const { result, calls } = await runAction("_new/create-template", {
    name: "Contract",
    templateType: "pdf",
    document: "//s3.amazonaws.com/appforest_uf/contract.pdf",
    detectFields: true,
    fieldSource: "auto",
    fieldNaming: "ai",
    fieldLogic: null,
    folderId: "fld_1",
    wait: true
  }, {
    responses: [
      { method: "POST", uri: `${US}/templates?wait=false`, status: 201, body: template("downloading") },
      { method: "GET", uri: `${US}/templates/tpl_123`, status: 200, body: template("pending") },
      { method: "GET", uri: `${US}/templates/tpl_123`, status: 200, body: template("processed") }
    ]
  });
  assert.deepEqual(calls[0].json, {
    template_type: "pdf",
    name: "Contract",
    parent_folder_id: "fld_1",
    document_url: "https://s3.amazonaws.com/appforest_uf/contract.pdf",
    detect_fields: true,
    field_source: "auto",
    field_naming: "ai"
  });
  assert.equal(result.success, true);
  assert.equal(result.documentState, "processed");
});

test("Create Template with HTML, and a PDF that can't be processed", async () => {
  const html = await runAction("_new/create-template", {
    name: "Invoice",
    templateType: "html",
    html: "<h1>{{ title }}</h1>",
    scss: "h1 { color: red; }",
    headerHtml: "<p>Header</p>",
    fieldSource: "auto"
  }, {
    responses: [{ method: "POST", status: 201, body: template(null, { template_type: "html", ready: true }) }]
  });
  assert.deepEqual(html.calls[0].json, {
    template_type: "html",
    name: "Invoice",
    html: "<h1>{{ title }}</h1>",
    scss: "h1 { color: red; }",
    header_html: "<p>Header</p>"
  });
  assert.equal(html.result.success, true);

  const broken = template("malformed_pdf");
  broken.document.error_message = "The PDF is damaged";
  const { result } = await runAction("_new/create-template", { document: "https://example.com/x.pdf", wait: false }, {
    responses: [{ method: "POST", status: 201, body: broken }]
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMessage, "The template's PDF couldn't be processed (state: malformed_pdf): The PDF is damaged\nTemplate: tpl_123");
});

test("Replace Template PDF", async () => {
  const { result, calls } = await runAction("_new/replace-template-pdf", {
    templateId: "tpl_123",
    documentBase64: "JVBERi0xLjQK",
    filename: "v2.pdf",
    reimportFields: true,
    wait: false
  }, {
    responses: [{ method: "PUT", uri: `${US}/templates/tpl_123/document?wait=false`, status: 200, body: template("pending") }]
  });
  assert.deepEqual(calls[0].json, { document_base64: "JVBERi0xLjQK", filename: "v2.pdf", reimport_fields: true });
  assert.equal(result.success, true);
  assert.equal(result.documentState, "pending");
  await assert.rejects(runAction("_new/replace-template-pdf", { templateId: "tpl_123" }), /Add the new PDF/);
});

test("Copy Template", async () => {
  const { calls } = await runAction("_new/copy-template", { templateId: "tpl_123", name: "Copy", folderId: "root", version: "1.0.0" }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/copy`, status: 201, body: template("processed", { id: "tpl_789" }) }]
  });
  assert.deepEqual(calls[0].json, { name: "Copy", parent_folder_id: null, version: "1.0.0" });
  const sameFolder = await runAction("_new/copy-template", { templateId: "tpl_123" }, {
    responses: [{ method: "POST", status: 201, body: template("processed") }]
  });
  assert.deepEqual(sameFolder.calls[0].json, {});
});

test("Move Template, to a folder or the root", async () => {
  const { result, calls } = await runAction("_new/move-template", { templateId: "tpl_123", folderId: "fld_2" }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/move`, status: 200, body: template("processed", { parent_folder_id: "fld_2", path: "/Other" }) }]
  });
  assert.deepEqual(calls[0].json, { parent_folder_id: "fld_2" });
  assert.equal(result.path, "/Other");
  const root = await runAction("_new/move-template", { templateId: "tpl_123", folderId: "" }, {
    responses: [{ method: "POST", status: 200, body: template("processed", { parent_folder_id: null, path: "/" }) }]
  });
  assert.deepEqual(root.calls[0].json, { parent_folder_id: null });
});

test("Publish Template Version", async () => {
  const { result, calls } = await runAction("_new/publish-template-version", { templateId: "tpl_123", versionType: "minor", description: "New logo" }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/publish_version`, status: 201, body: { version: "1.1.0", description: "New logo", published_at: "2026-10-27T00:00:00Z" } }]
  });
  assert.deepEqual(calls[0].json, { version_type: "minor", description: "New logo" });
  assert.equal(result.version, "1.1.0");
  await assert.rejects(runAction("_new/publish-template-version", { templateId: "tpl_123" }), /Version Type is required/);
});

const fields = { template_id: "tpl_123", version: null, fields: [{ id: 1, name: "first_name", type: "string" }, { id: 2, name: "signature", type: "signature" }] };

test("List Template Fields", async () => {
  const { result } = await runAction("_new/list-template-fields", { templateId: "tpl_123", version: "1.0.0" }, {
    responses: [{ method: "GET", uri: `${US}/templates/tpl_123/fields?version=1.0.0`, status: 200, body: fields }]
  });
  assert.deepEqual(result.ids, [1, 2]);
  assert.deepEqual(result.names, ["first_name", "signature"]);
  assert.deepEqual(result.types, ["string", "signature"]);
});

test("Add and Update Template Fields send the JSON list", async () => {
  const add = await runAction("_new/add-template-fields", { templateId: "tpl_123", fields: '[{"name": "first_name", "page": 1}]' }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/fields`, status: 201, body: fields }]
  });
  assert.deepEqual(add.calls[0].json, { fields: [{ name: "first_name", page: 1 }] });
  const update = await runAction("_new/update-template-fields", { templateId: "tpl_123", fields: '[{"id": 1, "required": true}]' }, {
    responses: [{ method: "PUT", uri: `${US}/templates/tpl_123/fields`, status: 200, body: fields }]
  });
  assert.deepEqual(update.calls[0].json, { fields: [{ id: 1, required: true }] });
  await assert.rejects(runAction("_new/add-template-fields", { templateId: "tpl_123", fields: "[]" }), /Fields \(JSON\) is required/);
});

test("Remove Template Fields sends whole-number IDs", async () => {
  const { calls } = await runAction("_new/remove-template-fields", { templateId: "tpl_123", fieldIds: "1, 2" }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/fields/remove`, status: 200, body: fields }]
  });
  assert.deepEqual(calls[0].json, { field_ids: [1, 2] });
  const list = await runAction("_new/remove-template-fields", { templateId: "tpl_123", fieldIds: [3, "4"] }, {
    responses: [{ method: "POST", status: 200, body: fields }]
  });
  assert.deepEqual(list.calls[0].json, { field_ids: [3, 4] });
  await assert.rejects(runAction("_new/remove-template-fields", { templateId: "tpl_123", fieldIds: "first_name" }), /Field IDs must be a whole number/);
});

test("Get Template Page Images", async () => {
  const { result } = await runAction("_new/get-template-page-images", { templateId: "tpl_123" }, {
    responses: [{
      method: "GET",
      uri: `${US}/templates/tpl_123/page_images`,
      status: 200,
      body: { template_id: "tpl_123", version: null, page_count: 2, pages: [{ download_url: "https://i/1.jpg" }, { download_url: "https://i/2.jpg" }] }
    }]
  });
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.images, ["https://i/1.jpg", "https://i/2.jpg"]);
});

test("a template that isn't processed yet is a 409 for its fields", async () => {
  const { result } = await runAction("_new/list-template-fields", { templateId: "tpl_123" }, {
    responses: [{ method: "GET", status: 409, body: v2Error("conflict", "The template's PDF is still being processed") }]
  });
  assert.equal(result.success, false);
  assert.match(result.errorMessage, /^DocSpring API error 409 conflict/);
  assert.deepEqual(result.ids, []);
});
