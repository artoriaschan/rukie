import { expect, test } from "bun:test";
import { listSessions } from "@rukie/agent";
import { start } from "../helpers/app";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2UAAAAASUVORK5CYII=";

test.each([
  ["zh_CN.UTF-8", "图片尺寸 8001×1 超过 8000 px 限制"],
  ["en_US.UTF-8", "Image dimensions 8001×1 exceed the 8000 px limit"],
])(
  "read image failures localize in %s while keeping English model content after resume",
  async (lang, copy) => {
    const app = await start(["read screenshot"], {
      env: { LANG: lang },
      prepare: async (root) => {
        const bytes = Buffer.from(png, "base64");
        bytes.writeUInt32BE(8001, 16);
        await Bun.write(`${root}/large.png`, bytes);
      },
    });
    let resumed: Awaited<ReturnType<typeof start>> | undefined;
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("read", { path: "large.png" });
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
        role: "toolResult",
        isError: true,
        content: [{ type: "text", text: "Image dimensions exceed the 8000 px limit." }],
        details: { code: "image-dimensions", params: { width: 8001, height: 1, maxPixels: 8000 } },
      });
      await app.waitFor(() => app.screen().join("\n").includes(copy));
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      const sessions = await listSessions({ cwd: app.root, homeDir: app.root });
      resumed = await start(["--resume", sessions[0]!.id], {
        env: { LANG: lang },
        session: { cwd: app.root, homeDir: app.root },
      });
      await resumed.waitFor(() => resumed!.screen().join("\n").includes(copy));
      resumed.stdin.write("continue\r");
      await resumed.waitFor(() => resumed!.calls.length === 1);
      expect(
        resumed.calls[0]!.context.messages.find((message) => message.role === "toolResult"),
      ).toMatchObject({
        content: [{ type: "text", text: "Image dimensions exceed the 8000 px limit." }],
        details: { code: "image-dimensions", params: { width: 8001, height: 1, maxPixels: 8000 } },
      });
      resumed.calls[0]!.finish();
    } finally {
      await resumed?.cleanup();
      await app.cleanup();
    }
  },
);
