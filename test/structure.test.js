// The plugin's files as Bubble reads them: every server.js shares one helper
// block, the existing actions keep their IDs, and each action's code reads
// only the fields its params.json declares.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ACTION_FOLDERS, ROOT, ACTIONS_DIR, actionDirs, readServerJs, readParams, declared, helperBlock } = require("./support/harness");

const EXISTING = {
  "AAP-850n0": {
    fields: {
      AAQ: "templateId", AAR: "data", AAS: "parseAsBoolean", AAg: "test", AAj: "metadata",
      ALO: "version", ALP: "makePageImages", ALQ: "password", ALR: "expiresIn", ALS: "fieldOverrides"
    },
    returns: {
      AAT: "id", AAU: "state", AAV: "file", AAW: "success", AAX: "errorMessage",
      AAh: "permanentFile", AAl: "response", ABq: "regionInfo", ALT: "pageImages"
    }
  },
  "AAY-850nj": {
    fields: { AAa: "submissionId" },
    returns: {
      AAb: "success", AAc: "id", AAd: "state", AAe: "file", AAf: "errorMessage", AAi: "permanentFile",
      AAn: "processedAt", AAo: "pdfHash", AAp: "templateId", AAq: "isTest", AAr: "expiresAt",
      AAs: "password", ABr: "regionInfo", ABs: "response", ALU: "pageImages"
    }
  }
};

test("every action has server.js, client.js and params.json", () => {
  const dirs = actionDirs();
  assert.equal(dirs.length, 30);
  dirs.forEach((dir) => {
    ["server.js", "client.js", "params.json"].forEach((file) => {
      assert.ok(fs.existsSync(path.join(ACTIONS_DIR, dir, file)), `${dir}/${file} is missing`);
    });
  });
});

test("every server.js has the same helper block", () => {
  const reference = helperBlock(readServerJs("AAP-850n0"));
  assert.ok(reference, "Create PDF Submission has no helper block");
  actionDirs().forEach((dir) => {
    const block = helperBlock(readServerJs(dir));
    assert.ok(block, `${dir}/server.js has no helper block`);
    assert.ok(block === reference, `${dir}/server.js's helper block differs: run node test/support/sync-helpers.js --write`);
  });
});

test("every server.js is a Bubble action function", () => {
  actionDirs().forEach((dir) => {
    const source = readServerJs(dir);
    assert.match(source, /^async function\(properties, context\) \{\n/, dir);
    // eslint-disable-next-line no-new-func
    assert.equal(typeof new Function(`return (${source});`)(), "function", dir);
  });
});

test("nothing calls API v1 or the AU region", () => {
  actionDirs().forEach((dir) => {
    const source = readServerJs(dir);
    assert.doesNotMatch(source, /\/api\/v1["'`/]/, `${dir} calls /api/v1`);
    assert.doesNotMatch(source, /api-au\.docspring\.com\/api/, `${dir} calls the AU region`);
  });
});

test("the existing actions keep their field and return value IDs and names", () => {
  Object.keys(EXISTING).forEach((dir) => {
    const params = readParams(dir);
    assert.equal(params.type, "server_side");
    const fieldNames = Object.fromEntries(Object.entries(params.fields).map(([id, field]) => [id, field.name]));
    const returnNames = Object.fromEntries(Object.entries(params.return_value).map(([id, entry]) => [id, entry.name]));
    assert.deepEqual(fieldNames, EXISTING[dir].fields, `${dir} fields`);
    assert.deepEqual(returnNames, EXISTING[dir].returns, `${dir} return values`);
  });
});

test("every ID is one Bubble assigned, unique per file, and every new action is mapped", () => {
  actionDirs().forEach((dir) => {
    assert.match(dir, /^A[A-Za-z0-9]{2}-[a-z0-9]{5}$/, `${dir} isn't a Bubble action folder`);
    const params = readParams(dir);
    const ids = Object.keys(params.fields || {}).concat(Object.keys(params.return_value || {}));
    assert.equal(new Set(ids).size, ids.length, `${dir} repeats an ID`);
    ids.forEach((id) => assert.match(id, /^A[A-Za-z0-9]{2}$/, `${dir} has ID ${id}`));
    assert.doesNotMatch(params.display, /Scaffold/, `${dir} is still a scaffold`);
  });
  const mapped = Object.values(ACTION_FOLDERS).sort();
  assert.deepEqual(mapped, actionDirs().filter((dir) => !EXISTING[dir]));
});

test("each server.js reads exactly the fields its params.json declares", () => {
  actionDirs().forEach((dir) => {
    const source = readServerJs(dir);
    const used = new Set([...source.matchAll(/properties\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
    const fields = declared(dir).fields;
    used.forEach((name) => {
      assert.ok(fields.includes(name), `${dir}/server.js reads properties.${name}, which isn't a field`);
    });
    fields.forEach((name) => {
      // Create Template reads its HTML fields through a name map ({ headerHtml: "header_html" }).
      assert.ok(used.has(name) || source.includes(` ${name}: "`), `${dir} never reads its field "${name}"`);
    });
  });
});

test("the shared settings keys are unchanged", () => {
  const shared = JSON.parse(fs.readFileSync(path.join(ROOT, "shared_tech_params.json"), "utf8"));
  assert.deepEqual(
    Object.fromEntries(Object.entries(shared.shared_keys).map(([id, key]) => [id, key.caption])),
    { AAC: "Token ID", AAD: "Token Secret", ABh: "Region" }
  );
});
