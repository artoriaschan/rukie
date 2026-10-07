import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import { isolateProxyEnvironment } from "../helpers/proxy-env";
isolateProxyEnvironment();
test("web body whitespace click expands and text click collapses", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(Array.from({ length: 10 }, (_, i) => `body${i}`).join("\n")),
  });
  const app = await start(["--yolo", "run"], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    session: {
      webFetch: {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        allowAddresses: ["127.0.0.1"],
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("web_fetch", { url: `http://site.test:${server.port}/docs` });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const row = app.screen().findIndex((x) => x.includes("body0"));
    expect(row).toBeGreaterThanOrEqual(0);
    app.stdin.write(`\x1b[<0;30;${row + 1}M\x1b[<0;30;${row + 1}m`);
    await app.waitFor(() => app.screen().join("\n").includes("body9"));
    expect(app.screen().join("\n")).toContain("body9");
    app.stdin.write(`\x1b[<0;6;${row + 1}M\x1b[<0;6;${row + 1}m`);
    await app.waitFor(() => app.screen().join("\n").includes("+7 lines"));
    expect(app.screen().join("\n")).not.toContain("body9");
  } finally {
    await app.cleanup();
    server.stop(true);
  }
});
test("read upstream truncation disclosure must remain outside fold", async () => {
  const app = await start(["--yolo", "run"], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(
        `${root}/large.txt`,
        Array.from({ length: 2200 }, (_, i) => `line${i}`).join("\n"),
      );
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "large.txt" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("Full output unavailable");
    expect(app.screen().join("\n")).toContain("Use offset=2001 to continue");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400"));
    expect(app.screen().join("\n")).toContain("Use offset=2001 to continue");
  } finally {
    await app.cleanup();
  }
});
import { createSession } from "@rukie/agent";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model";
function fakeModel(replies: FauxResponseStep[]) {
  const core = createFauxCore({ api: "faux", provider: "faux" });
  core.setResponses(replies);
  return {
    model: core.getModel(),
    streamFn: withAuxiliaryRequests((model, context, options) =>
      core.streamSimple(model, context, options),
    ),
  };
}
test("bash full output recovery footnote is never folded away", async () => {
  const app = await start(["--yolo", "run"], { rows: 40, env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "seq 1 2200", description: "Truncated output" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("Full output:");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400"));
    expect(app.screen().join("\n")).toContain("Full output:");
  } finally {
    await app.cleanup();
  }
});
import { readdir } from "node:fs/promises";
test("resumed missing edit facts falls back to raw result", async () => {
  const argv: string[] = [];
  const app = await start(argv, {
    // This case checks legacy source fallback; leave room for JSON and header metadata.
    columns: 100,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/file.txt`, "before\n");
      const session = await createSession({
        cwd: root,
        homeDir: root,
        permissionMode: "full-access",
        ...fakeModel([
          fauxAssistantMessage(
            fauxToolCall("edit", {
              path: "file.txt",
              edits: [{ oldText: "before", newText: "after" }],
            }),
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("done"),
        ]),
      });
      await session.run("edit");
      await session.dispose();
      const files = await readdir(`${root}/.rukie/sessions`, { recursive: true });
      for (const file of files.filter((f) => f.endsWith(".jsonl"))) {
        const path = `${root}/.rukie/sessions/${file}`;
        const source = await Bun.file(path).text();
        const updated = source
          .split("\n")
          .map((line) => {
            if (!line) return line;
            const item: unknown = JSON.parse(line);
            function change(value: unknown) {
              if (!value || typeof value !== "object") return;
              if (Array.isArray(value)) {
                value.forEach(change);
                return;
              }
              if (!("role" in value)) {
                Object.values(value).forEach(change);
                return;
              }
              if (value.role === "toolResult" && "toolName" in value && value.toolName === "edit") {
                Object.assign(value, {
                  details: {},
                  content: [{ type: "text", text: "LEGACY_RAW_RESULT" }],
                });
              }
              for (const child of Object.values(value)) change(child);
            }
            change(item);
            return JSON.stringify(item);
          })
          .join("\n");
        await Bun.write(path, updated);
      }
      argv.push("--resume", session.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.includes("Edit(")));
    expect(app.screen().join("\n")).toContain(
      'Edit({"path":"file.txt","edits":[{"oldText":"before","newText":"after"}]}',
    );
    expect(app.screen().join("\n")).toContain("LEGACY_RAW_RESULT");
    app.stdin.write("\x0f/LEGACY_RAW_RESULT\r");
    await app.waitFor(() => app.screen().join("\n").includes("1/1"));
  } finally {
    await app.cleanup();
  }
});
