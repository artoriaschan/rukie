import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import { isolateProxyEnvironment } from "../helpers/proxy-env.ts";

isolateProxyEnvironment();

test.each([120, 60])("web_fetch shows its URL and Markdown body at %s columns", async (columns) => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("public page body"),
  });
  const url = `http://site.test:${server.port}/docs`;
  const app = await start(["--yolo", "read docs"], {
    columns,
    rows: 24,
    session: {
      webFetch: {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        allowAddresses: ["127.0.0.1"],
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("web_fetch", { url });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.allLines().join("\n").includes("public page body"),
    );
    expect(app.allLines().some((line) => line.startsWith(`• 获取网页(${url})`))).toBe(true);
    expect(app.allLines().join("\n")).not.toContain(`Fetched ${url}`);
    expect(app.allLines().join("\n")).toContain("public page body");
    expect(app.screen().every((line) => Bun.stringWidth(line) <= columns)).toBe(true);
  } finally {
    await app.cleanup();
    server.stop(true);
  }
});

test.each([
  ["zh", "网页抓取"],
  ["en", "WebFetch"],
] as const)(
  "%s permission dialog localizes the tool name and displays the complete URL",
  async (locale, label) => {
    const url = "https://docs.example.com/path?topic=fetch";
    const app = await start(["read docs"], { columns: 100, rows: 24, env: { LANG: locale } });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("web_fetch", { url });
      await app.waitFor(() => app.screen().some((line) => line.includes(label)));
      expect(app.screen().join("\n")).toContain(url);
      app.stdin.write("\x1b");
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: true });
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
    } finally {
      await app.cleanup();
    }
  },
);
