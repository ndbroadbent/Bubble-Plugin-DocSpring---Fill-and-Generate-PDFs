// IDs that go into URL paths: encoded, and never "." or ".." (which would
// change the path, such as a submission ID of ".." deleting something else).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAction, actionDirs, readServerJs, helperBlock, US } = require("./support/harness");

// Each action that puts an input ID in a URL path, with that field.
const PATH_IDS = [
  ["AAP-850n0", "templateId", "Template ID"],
  ["AAY-850nj", "submissionId", "Submission ID"],
  ["get-submission-batch", "batchId", "Batch ID"],
  ["check-data", "templateId", "Template ID"],
  ["find-submissions", "templateId", "Template ID"],
  ["generate-submission-files", "submissionId", "Submission ID"],
  ["expire-submission", "submissionId", "Submission ID"],
  ["get-combined-pdf", "combinedPdfId", "Combined PDF ID"],
  ["create-signature-request", "templateId", "Template ID"],
  ["create-signing-link", "signatureRequestId", "Signature Request ID"],
  ["get-signature-request", "signatureRequestId", "Signature Request ID"],
  ["get-template", "templateId", "Template ID"],
  ["replace-template-pdf", "templateId", "Template ID"],
  ["copy-template", "templateId", "Template ID"],
  ["move-template", "templateId", "Template ID"],
  ["publish-template-version", "templateId", "Template ID"],
  ["list-template-fields", "templateId", "Template ID"],
  ["add-template-fields", "templateId", "Template ID"],
  ["update-template-fields", "templateId", "Template ID"],
  ["remove-template-fields", "templateId", "Template ID"],
  ["get-template-page-images", "templateId", "Template ID"],
  ["delete-webhook", "webhookId", "Webhook ID"]
];

test('an ID of "." or ".." is an error, before any request', async () => {
  for (const [action, field, name] of PATH_IDS) {
    for (const value of [".", "..", " .. "]) {
      const dots = value.trim();
      await assert.rejects(
        runAction(action, { [field]: value }),
        { message: `${name} can't be "${dots}".` },
        `${action} with ${field} ${JSON.stringify(value)}`
      );
    }
  }
});

test("IDs with dots or slashes inside them are encoded, not rejected", async () => {
  await runAction("delete-webhook", { webhookId: "../templates/tpl_1" }, {
    responses: [{ method: "DELETE", uri: `${US}/webhooks/..%2Ftemplates%2Ftpl_1`, status: 200, body: {} }]
  });
  await runAction("find-submissions", { templateId: "tpl_1/..", testFilter: "any" }, {
    responses: [{ method: "GET", uri: `${US}/templates/tpl_1%2F../submissions`, status: 200, body: { data: [] } }]
  });
});

test("outside the helper block, only IDs DocSpring returned are encoded directly (inputs go through pathId)", () => {
  actionDirs().forEach((dir) => {
    const source = readServerJs(dir).replace(helperBlock(readServerJs(dir)), "");
    [...source.matchAll(/encodeURIComponent\(([^)]*)\)/g)].forEach((match) => {
      assert.match(match[1], /^[A-Za-z]+\.id$/, `${dir} encodes ${match[1]} itself: use pathId`);
    });
  });
});
