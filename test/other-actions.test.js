// New folder, webhook and API call actions (actions/_new).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, v2Error, US } = require("./support/harness");

test("List Folders", async () => {
  const { result } = await runAction("_new/list-folders", { parentFolderId: "fld_1", limit: 100 }, {
    responses: [{
      method: "GET",
      uri: `${US}/folders?parent_folder_id=fld_1&limit=100`,
      status: 200,
      body: { data: [{ id: "fld_2", name: "2026", path: "/Contracts" }], next_cursor: "fld_2" }
    }]
  });
  assert.deepEqual(result.ids, ["fld_2"]);
  assert.deepEqual(result.names, ["2026"]);
  assert.deepEqual(result.paths, ["/Contracts"]);
  assert.equal(result.nextCursor, "fld_2");
});

test("Create Folder", async () => {
  const { result, calls } = await runAction("_new/create-folder", { name: "2026", parentFolderId: "fld_1" }, {
    responses: [{ method: "POST", uri: `${US}/folders`, status: 201, body: { id: "fld_2", name: "2026", path: "/Contracts", parent_folder_id: "fld_1" } }]
  });
  assert.deepEqual(calls[0].json, { name: "2026", parent_folder_id: "fld_1" });
  assert.equal(result.id, "fld_2");
  await assert.rejects(runAction("_new/create-folder", { name: " " }), /Name is required/);
});

test("Create Webhook posts a flat body with no version", async () => {
  const { result, calls } = await runAction("_new/create-webhook", {
    url: "https://myapp.bubbleapps.io/version-test/api/1.1/wf/docspring_event",
    eventTypes: "submission.processed, submission.failed",
    templateIds: ["tpl_123"],
    name: ""
  }, {
    responses: [{ method: "POST", uri: `${US}/webhooks`, status: 201, body: { id: "whk_123", version: 4, secret: "whsec" } }]
  });
  assert.deepEqual(calls[0].json, {
    url: "https://myapp.bubbleapps.io/version-test/api/1.1/wf/docspring_event",
    event_types: ["submission.processed", "submission.failed"],
    template_ids: ["tpl_123"]
  });
  assert.equal(result.id, "whk_123");
  assert.equal(result.secret, "whsec");
  await assert.rejects(runAction("_new/create-webhook", { url: "https://x.example.com" }), /Event Types is required/);
});

test("Delete Webhook treats a 404 as already deleted", async () => {
  const deleted = await runAction("_new/delete-webhook", { webhookId: "whk_123" }, {
    responses: [{ method: "DELETE", uri: `${US}/webhooks/whk_123`, status: 200, body: { id: "whk_123" } }]
  });
  assert.equal(deleted.result.success, true);
  const gone = await runAction("_new/delete-webhook", { webhookId: "whk_123" }, {
    responses: [{ method: "DELETE", status: 404, body: v2Error("not_found", "Webhook not found") }]
  });
  assert.equal(gone.result.success, true);
  assert.equal(gone.result.id, "whk_123");
  const denied = await runAction("_new/delete-webhook", { webhookId: "whk_123" }, {
    responses: [{ method: "DELETE", status: 401, body: v2Error("unauthorized", "Invalid API token") }]
  });
  assert.equal(denied.result.success, false);
});

test("Make an API Call sends any API v2 request", async () => {
  const { result, calls } = await runAction("_new/make-an-api-call", {
    method: "post",
    path: "/api/v2/templates/tpl_123/copy?x=1",
    query: [{ key: "y", value: "2" }],
    body: '{"name": "Copy"}'
  }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/copy?y=2&x=1`, status: 201, body: { id: "tpl_789" } }]
  });
  assert.deepEqual(calls[0].json, { name: "Copy" });
  assert.equal(result.success, true);
  assert.equal(result.statusCode, 201);
  assert.deepEqual(JSON.parse(result.response), { id: "tpl_789" });

  const failed = await runAction("_new/make-an-api-call", { path: "templates/tpl_x" }, {
    responses: [{ method: "GET", uri: `${US}/templates/tpl_x`, status: 404, body: v2Error("not_found", "Template not found") }]
  });
  assert.equal(failed.result.success, false);
  assert.equal(failed.result.statusCode, 404);
  assert.match(failed.result.errorMessage, /404 not_found: Template not found/);

  await assert.rejects(runAction("_new/make-an-api-call", { path: "https://api.docspring.com/api/v1/templates" }), /relative to \/api\/v2/);
  await assert.rejects(runAction("_new/make-an-api-call", { path: "/../v1/templates" }), /can't contain/);
  await assert.rejects(runAction("_new/make-an-api-call", { path: "/templates", method: "PATCH" }), /Method must be/);
});
