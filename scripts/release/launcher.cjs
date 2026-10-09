#!/usr/bin/env node
"use strict";
const { constants, accessSync, realpathSync } = require("node:fs");
const { dirname, join } = require("node:path");
function fail(message) {
  process.stderr.write(`rukie: ${message}\n`);
  process.exit(1);
}
if (process.platform !== "darwin" || process.arch !== "arm64") {
  fail(
    `Unsupported platform ${process.platform}/${process.arch}. Rukie currently supports macOS arm64 (Apple Silicon) only.`,
  );
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (typeof process.execve !== "function" || major < 24 || (major === 24 && minor < 15)) {
  fail("Node.js 24.15.0 or newer is required. Upgrade Node.js and reinstall @rukie/coding-agent.");
}
let binary;
try {
  const manifest = require.resolve("@rukie/coding-agent-darwin-arm64/package.json");
  const expected = require("../package.json").version;
  if (require(manifest).version !== expected)
    throw new Error("platform package version does not match");
  binary = realpathSync(join(dirname(manifest), "bin/rukie"));
  accessSync(binary, constants.X_OK);
} catch (error) {
  fail(
    `The macOS arm64 platform package is missing or incomplete. Reinstall @rukie/coding-agent with optional dependencies enabled (npm install --include=optional @rukie/coding-agent). ${error.message}`,
  );
}
// Replace the launcher: terminal foreground signals reach exactly one product process.
// cwd, environment, fds 0-2 and process identity are preserved by the POSIX exec boundary.
try {
  process.execve(binary, [binary, ...process.argv.slice(2)], process.env);
} catch (error) {
  fail(`Cannot start the macOS arm64 executable. Reinstall @rukie/coding-agent. ${error.message}`);
}
