#!/usr/bin/env node
"use strict";
const { constants, accessSync, realpathSync } = require("node:fs");
const { dirname, join } = require("node:path");
function fail(message) {
  process.stderr.write(`rukie: ${message}\n`);
  process.exit(1);
}
const zh = /^zh(?:[_-]|$)/i.test(
  process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "en",
);
const main = require("../package.json");
const target = `${main.name}-${process.platform}-${process.arch}`;
const platform =
  process.platform === "darwin" ? `macOS ${process.arch}` : `${process.platform}/${process.arch}`;
const supported = Object.keys(main.optionalDependencies || {})
  .map((name) => name.slice(main.name.length + 1))
  .join(", ");
if (!main.optionalDependencies?.[target]) {
  fail(
    zh
      ? `不支持的平台 ${process.platform}/${process.arch}。支持的平台：${supported}（macOS arm64 为 Apple Silicon）。`
      : `Unsupported platform ${process.platform}/${process.arch}. Supported platforms: ${supported} (macOS arm64 is Apple Silicon).`,
  );
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (typeof process.execve !== "function" || major < 24 || (major === 24 && minor < 15)) {
  fail(
    zh
      ? "需要 Node.js 24.15.0 或更新版本。请升级 Node.js 并重新安装 @rukie/coding-agent。"
      : "Node.js 24.15.0 or newer is required. Upgrade Node.js and reinstall @rukie/coding-agent.",
  );
}
let binary;
try {
  const manifest = require.resolve(`${target}/package.json`);
  const expected = main.version;
  if (require(manifest).version !== expected)
    throw new Error("platform package version does not match");
  binary = realpathSync(join(dirname(manifest), "bin/rukie"));
  accessSync(binary, constants.X_OK);
} catch (error) {
  fail(
    zh
      ? `${platform} 平台包缺失或不完整。请启用可选依赖重新安装（npm install --include=optional @rukie/coding-agent）。${error.message}`
      : `The ${platform} platform package is missing or incomplete. Reinstall @rukie/coding-agent with optional dependencies enabled (npm install --include=optional @rukie/coding-agent). ${error.message}`,
  );
}
// Replace the launcher: terminal foreground signals reach exactly one product process.
// cwd, environment, fds 0-2 and process identity are preserved by the POSIX exec boundary.
try {
  process.execve(binary, [binary, ...process.argv.slice(2)], process.env);
} catch (error) {
  fail(
    zh
      ? `无法启动 ${platform} 可执行文件。请重新安装 @rukie/coding-agent。${error.message}`
      : `Cannot start the ${platform} executable. Reinstall @rukie/coding-agent. ${error.message}`,
  );
}
