// Runs an action's server.js the way Bubble does: an async function called with
// (properties, context). context.v3.request is mocked, and setTimeout resolves
// at once, so tests never touch the network or wait for polling.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const ACTIONS_DIR = path.join(ROOT, "actions");

const DEFAULT_KEYS = { "Token ID": "token_id", "Token Secret": "token_secret", Region: "" };
const US = "https://api.docspring.com/api/v2";

// Bubble names action folders by ID; tests name the new actions by slug (test/support/actions.json).
const ACTION_FOLDERS = JSON.parse(fs.readFileSync(path.join(__dirname, "actions.json"), "utf8"));

function resolve(dir) {
  return ACTION_FOLDERS[dir] || dir;
}

// Every action folder that has a server.js.
function actionDirs() {
  const dirs = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isDirectory()) return;
      const full = path.join(dir, entry.name);
      if (fs.existsSync(path.join(full, "server.js"))) dirs.push(path.relative(ACTIONS_DIR, full));
      walk(full);
    });
  };
  walk(ACTIONS_DIR);
  return dirs.sort();
}

function readServerJs(dir) {
  return fs.readFileSync(path.join(ACTIONS_DIR, resolve(dir), "server.js"), "utf8");
}

function readParams(dir) {
  return JSON.parse(fs.readFileSync(path.join(ACTIONS_DIR, resolve(dir), "params.json"), "utf8"));
}

// The field and return value names an action's params.json declares.
function declared(dir) {
  const params = readParams(dir);
  const names = (key) => Object.values(params[key] || {}).map((entry) => entry.name);
  return { fields: names("fields"), returns: names("return_value") };
}

function loadAction(dir, sleeps) {
  const source = readServerJs(dir);
  const fakeSetTimeout = (callback, ms) => {
    sleeps.push(ms);
    callback();
    return 0;
  };
  const quietConsole = { log() {}, warn() {}, error() {}, info() {} };
  // eslint-disable-next-line no-new-func
  return new Function("setTimeout", "console", `return (${source});`)(fakeSetTimeout, quietConsole);
}

// responses: a list of { method, uri, status, body, headers } (or { throws }) in the
// order the action should make its requests. Asserts each request's method
// and URI, and that every response was used.
async function runAction(dir, properties, options) {
  const opts = options || {};
  const responses = (opts.responses || []).slice();
  const calls = [];
  const sleeps = [];
  const context = {
    keys: Object.assign({}, DEFAULT_KEYS, opts.keys || {}),
    v3: {
      request: async (requestOptions) => {
        calls.push(requestOptions);
        const expected = responses.shift();
        assert.ok(expected, `Unexpected request: ${requestOptions.method} ${requestOptions.uri}`);
        if (expected.method) assert.equal(requestOptions.method, expected.method, "request method");
        if (expected.uri) assert.equal(requestOptions.uri, expected.uri, "request URI");
        if (expected.throws) throw expected.throws;
        return { statusCode: expected.status, body: expected.body, headers: expected.headers || {} };
      }
    }
  };
  const action = loadAction(dir, sleeps);
  const result = await action(properties, context);
  if (!opts.allowUnusedResponses) {
    assert.equal(responses.length, 0, `${responses.length} expected request(s) weren't made`);
  }
  const returns = declared(dir).returns;
  Object.keys(result).forEach((key) => {
    assert.ok(returns.includes(key), `${dir} returns "${key}", which its params.json doesn't declare`);
  });
  return { result, calls, sleeps };
}

// The helper block every server.js shares.
function helperBlock(source) {
  const start = source.indexOf("  // ---- DocSpring plugin helpers ----");
  const endMarker = "  // ---- end of DocSpring plugin helpers ----";
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1) return null;
  return source.slice(start, end + endMarker.length);
}

const v2Error = (code, message, extra) => ({
  error: Object.assign({ code, message, details: [], request_id: "req_123" }, extra || {})
});

const submission = (overrides) =>
  Object.assign(
    {
      id: "sub_123",
      template_id: "tpl_123",
      state: "processed",
      test: true,
      error_message: null,
      metadata: {},
      files: {
        pdf: {
          state: "processed",
          download_url: "https://downloads.example.com/sub_123.pdf",
          permanent_url: "https://app.docspring.com/submissions/sub_123/files/pdf",
          sha256: "abc123"
        }
      },
      expires_at: "2026-11-27T00:00:00Z",
      processed_at: "2026-10-27T00:00:01Z",
      signature_requests: []
    },
    overrides || {}
  );

module.exports = {
  ACTION_FOLDERS,
  ROOT,
  ACTIONS_DIR,
  US,
  actionDirs,
  readServerJs,
  readParams,
  declared,
  runAction,
  helperBlock,
  v2Error,
  submission
};
