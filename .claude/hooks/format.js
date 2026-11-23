// PostToolUse hook: after Claude edits a file, format it with Prettier (run via npx, no install).
// Reads the hook JSON from stdin; never blocks Claude (always exits 0).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PRETTIER = "prettier@3.3.3"; // pinned so results are reproducible
const EXT = new Set([".js", ".css", ".html", ".json"]); // file types we format
const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

// Decide whether a file should be formatted: right type, inside the project, not in <project>/data/.
function shouldFormat(file) {
  if (!file || !EXT.has(path.extname(file).toLowerCase())) return false;
  const rel = path.relative(PROJECT, path.resolve(file));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false; // outside the project
  if (rel.split(path.sep)[0] === "data") return false; // personal data folder
  return fs.existsSync(path.resolve(file));
}

// Find how to start npx without a shell (a shell would interpret characters like & or | in file names).
// On Windows npx is a .cmd file that cannot be spawned directly, so run npm's npx-cli.js with node.
function npxCommand() {
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (fs.existsSync(cli)) return [process.execPath, [cli]];
  if (process.platform !== "win32") return ["npx", []];
  return null;
}

// Run Prettier on one file; report problems on stderr but do not fail.
function format(file) {
  const cmd = npxCommand();
  if (!cmd) return console.error("format hook: npx-cli.js not found next to node; skipped");
  const args = [...cmd[1], "--yes", PRETTIER, "--write", path.resolve(file)];
  const r = spawnSync(cmd[0], args, { encoding: "utf8", timeout: 60000 });
  if (r.error) console.error("format hook: " + r.error.message);
  else if (r.status !== 0) console.error("format hook: prettier failed\n" + (r.stderr || ""));
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk)); // collect stdin
process.stdin.on("end", () => {
  // stdin finished: parse the hook JSON and format the edited file
  try {
    const file = JSON.parse(raw)?.tool_input?.file_path;
    if (shouldFormat(file)) format(file);
  } catch (e) {
    console.error("format hook: " + e.message);
  }
});
