// PostToolUse hook: after Claude edits a file, format it with Prettier (run via npx, no install).
// Reads the hook JSON from stdin; never blocks Claude (always exits 0).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PRETTIER = "prettier@3.3.3"; // pinned so results are reproducible
const EXT = new Set([".js", ".css", ".html", ".json"]); // file types we format
const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

// Decide whether a file should be formatted: right type, inside the project, not in <project>/data/.
// Symlinks are resolved and names compared in lower case, since Windows paths are case-insensitive.
function shouldFormat(file) {
  if (!file || !EXT.has(path.extname(file).toLowerCase())) return false;
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) return false;
  const rel = path.relative(fs.realpathSync(PROJECT), fs.realpathSync(abs)).toLowerCase();
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return false; // outside the project
  return rel.split(path.sep)[0] !== "data"; // personal data folder is never formatted
}

// Find how to start npx without a shell (a shell would interpret characters like & or | in file names).
// On Windows npx is a .cmd file that cannot be spawned directly, so run npm's npx-cli.js with node.
function npxCommand() {
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (fs.existsSync(cli)) return { bin: process.execPath, pre: [cli] };
  if (process.platform !== "win32") return { bin: "npx", pre: [] };
  return null;
}

// Run Prettier on one file from the project root (so .prettierrc/.prettierignore apply); report problems, never fail.
function format(file) {
  const cmd = npxCommand();
  if (!cmd) {
    console.error("format hook: npx-cli.js not found next to node; skipped");
    return;
  }
  const args = [...cmd.pre, "--yes", PRETTIER, "--write", path.resolve(file)];
  const r = spawnSync(cmd.bin, args, { cwd: PROJECT, encoding: "utf8", timeout: 60000 });
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
