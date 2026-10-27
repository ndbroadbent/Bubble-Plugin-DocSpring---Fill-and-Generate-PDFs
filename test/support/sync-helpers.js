// Copies the helper block from Create PDF Submission's server.js into every
// other action's server.js. After changing the helpers there, run:
//   node test/support/sync-helpers.js --write
// (node --test also loads this file, so it only writes with --write.)
const fs = require("node:fs");
const path = require("node:path");
const { ACTIONS_DIR, actionDirs, readServerJs, helperBlock } = require("./harness");

if (process.argv.includes("--write")) {
  const reference = helperBlock(readServerJs("AAP-850n0"));
  if (!reference) throw new Error("actions/AAP-850n0/server.js has no helper block");
  actionDirs().forEach((dir) => {
    const source = readServerJs(dir);
    const block = helperBlock(source);
    if (!block) throw new Error(`actions/${dir}/server.js has no helper block`);
    if (block !== reference) {
      fs.writeFileSync(path.join(ACTIONS_DIR, dir, "server.js"), source.replace(block, () => reference));
      console.log(`updated actions/${dir}/server.js`);
    }
  });
}
