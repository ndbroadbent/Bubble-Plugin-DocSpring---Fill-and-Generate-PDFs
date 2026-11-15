// Data (JSON) on the actions that send submission data: Create Submission,
// Check Data and Create Signature Request. Bubble sends the Data list's values
// as text, so a list (such as a table's rows) comes in Data (JSON).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, submission, US } = require("./support/harness");

const ROWS = [{ domingo: "1", sabado: "7" }, { domingo: "8", sabado: "14" }];

test("Create Submission sends Data (JSON)'s lists as lists, merged with the Data list", async () => {
  const { calls } = await runAction("AAP-850n0", {
    templateId: "tpl_123",
    data: [{ key: "name", value: "Paróquia" }, { key: "titulo", value: "from the list" }],
    dataJson: JSON.stringify({ titulo: "Calendário", line_items: ROWS })
  }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/submissions?wait=false`, status: 201, body: submission() }]
  });
  // A key in both takes the JSON's value.
  assert.deepEqual(calls[0].json.data, { name: "Paróquia", titulo: "Calendário", line_items: ROWS });
});

test("Create Submission takes Data (JSON) alone, and a blank one changes nothing", async () => {
  const uri = `${US}/templates/tpl_123/submissions?wait=false`;
  const alone = await runAction("AAP-850n0", { templateId: "tpl_123", dataJson: '{"line_items": []}' }, {
    responses: [{ method: "POST", uri, status: 201, body: submission() }]
  });
  assert.deepEqual(alone.calls[0].json.data, { line_items: [] });

  for (const dataJson of ["", "  ", null, undefined]) {
    const { calls } = await runAction("AAP-850n0", { templateId: "tpl_123", data: [{ key: "a", value: "x" }], dataJson }, {
      responses: [{ method: "POST", uri, status: 201, body: submission() }]
    });
    assert.deepEqual(calls[0].json.data, { a: "x" }, `dataJson: ${JSON.stringify(dataJson)}`);
  }
});

test("Data (JSON) must be a JSON object, and an error names the field", async () => {
  const signer = { signerEmail: "jane@example.com", signerFields: "signature" };
  for (const [action, extra] of [["AAP-850n0", {}], ["check-data", {}], ["create-signature-request", signer]]) {
    const run = (dataJson) => runAction(action, Object.assign({ templateId: "tpl_123", dataJson }, extra));
    await assert.rejects(run("{line_items: ["), /Data \(JSON\) isn't valid JSON/);
    await assert.rejects(run(JSON.stringify(ROWS)), /Data \(JSON\) must be a JSON object/);
    await assert.rejects(run('"text"'), /Data \(JSON\) must be a JSON object/);
  }
});

test("Check Data checks Data (JSON) merged with the Data list", async () => {
  const { calls } = await runAction("check-data", {
    templateId: "tpl_123",
    data: [{ key: "name", value: "Paróquia" }],
    dataJson: JSON.stringify({ line_items: ROWS })
  }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/submissions/validate`, status: 200, body: { valid: true } }]
  });
  assert.deepEqual(calls[0].json, { data: { name: "Paróquia", line_items: ROWS } });
});

test("Create Signature Request sends Data (JSON) merged with the Data list", async () => {
  const { calls } = await runAction("create-signature-request", {
    templateId: "tpl_123",
    signerEmail: "jane@example.com",
    signerFields: "signature",
    data: [{ key: "name", value: "Paróquia" }],
    dataJson: JSON.stringify({ line_items: ROWS })
  }, {
    responses: [{ method: "POST", uri: `${US}/templates/tpl_123/submissions`, status: 201, body: {
      id: "sub_1", state: "waiting_for_signature_requests",
      signature_requests: [{ id: "srq_1", state: "pending", send_email: true }]
    } }]
  });
  assert.deepEqual(calls[0].json.data, { name: "Paróquia", line_items: ROWS });
});
