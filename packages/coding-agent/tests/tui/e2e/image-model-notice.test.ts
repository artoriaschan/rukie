import { startWithClock } from "../helpers/clock-app";
import { afterEach, expect, test } from "bun:test";
import { dark } from "../../../src/ink/index.ts";
import { start } from "../helpers/app";

const key = "RUKIE_IMAGE_MODEL_NOTICE_KEY";
const previousKey = process.env[key];
afterEach(() => {
  if (previousKey === undefined) delete process.env[key];
  else process.env[key] = previousKey;
});
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2UAAAAASUVORK5CYII=";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
const settings = {
  model: "img/text",
  providers: [
    {
      id: "img",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:1/v1",
      apiKeyEnv: key,
      models: [{ id: "text" }, { id: "vision", input: ["text", "image"] }],
    },
  ],
};
async function startImages(
  model = "text",
  lang = "en_US.UTF-8",
  columns = 80,
  rows = 24,
  virtualTime = false,
) {
  process.env[key] = "test-key";
  return (virtualTime ? startWithClock : start)([], {
    env: { LANG: lang },
    columns,
    rows,
    session: { model: undefined },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
      await Bun.write(
        `${root}/.rukie/settings.json`,
        JSON.stringify({ ...settings, model: `img/${model}` }),
      );
    },
  });
}

test("text-only model paste keeps the token and success notice while adding one warning", async () => {
  const app = await startImages();
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() =>
      app.screen().join("\n").includes("img/text does not accept images; they will be omitted"),
    );
    const screen = app.screen().join("\n");
    expect(screen).toContain("❯ [Image #1]");
    expect(screen).toContain("Pasted image [Image #1]");
    expect(screen.match(/does not accept images/g)).toHaveLength(1);
    const warningRow = app.screen().findIndex((line) => line.includes("does not accept images"));
    expect(app.terminal.buffer.active.getLine(warningRow)!.getCell(0)!.getFgColor()).toBe(
      parseInt(dark.warning.slice(1), 16),
    );
    app.stdin.write("inspect\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [
        { type: "text", text: "[Image #1] inspect" },
        { type: "image", data: png, mimeType: "image/png" },
      ],
    });
    await app.waitFor(() => app.screen().some((line) => line.includes("[Image · shot.png]")));
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("a long valid model ID keeps image warning, editor and status usable at 40×12 and after resize", async () => {
  const id = "custom-" + "m".repeat(300);
  process.env[key] = "test-key";
  const app = await start([], {
    columns: 40,
    rows: 12,
    env: { LANG: "en_US.UTF-8" },
    session: { model: undefined },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
      await Bun.write(
        `${root}/.rukie/settings.json`,
        JSON.stringify({
          ...settings,
          model: `img/${id}`,
          providers: [{ ...settings.providers[0], models: [{ id }] }],
        }),
      );
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().join("\n").includes("does not accept images"));
    expect(app.screen().join("\n")).toContain("❯ [Image #1]");
    expect(app.screen().join("\n")).toContain("Pasted image [Image #1]");
    expect(app.screen().join(" ")).toContain("will be omitted");
    expect(app.screen().at(-2)).toContain("Ask");
    app.resize(80, 24);
    await app.waitFor(() =>
      app.screen().some((line) => line.startsWith("╭") && line.length === 80),
    );
    app.resize(40, 12);
    await app.waitFor(
      () =>
        app.screen().some((line) => line.startsWith("╭") && line.length === 40) &&
        app.screen().at(-2)!.includes("Ask"),
    );
    expect(app.screen().join("\n")).toContain("❯ [Image #1]");
    app.stdin.write("inspect\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [
        { type: "text", text: "[Image #1] inspect" },
        { type: "image", data: png },
      ],
    });
    expect(app.screen().at(-2)).toContain("Ask");
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("switching a Session with transcript images to a text model warns once and keeps its images", async () => {
  const app = await startImages("vision");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().join("\n").includes("Pasted image [Image #1]"));
    expect(app.screen().join("\n")).not.toContain("does not accept images");
    app.stdin.write("inspect\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/model img/text\r");
    await app.waitFor(() =>
      app.screen().join("\n").includes("img/text does not accept images; they will be omitted"),
    );
    expect(
      app
        .screen()
        .join("\n")
        .match(/does not accept images/g),
    ).toHaveLength(1);
    app.resize(80, 40);
    await app.waitFor(() => app.screen().join("\n").includes("[Image · shot.png]"));
    app.stdin.write("continue\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(JSON.stringify(app.calls[1]!.context.messages)).toContain(png);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/model img/vision\r");
    await app.waitFor(() => app.screen().join("\n").includes("Model changed to img/vision"));
    expect(app.screen().join("\n")).not.toContain("does not accept images");
  } finally {
    await app.cleanup();
  }
});

test.each(["picker", "explicit"])(
  "/model %s switches with a bound draft image and warns before attachments reset",
  async (mode) => {
    const app = await startImages("vision");
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write(
        (mode === "picker" ? "/model " : "/model img/text ") + paste(`${app.root}/shot.png`),
      );
      await app.waitFor(() => app.screen().join("\n").includes("Pasted image [Image #1]"));
      app.stdin.write("\r");
      if (mode === "picker") {
        await app.waitFor(() => app.screen().join("\n").includes("Select model"));
        app.stdin.write("\x1b[A");
        await app.waitFor(() =>
          app.screen().some((line) => line.includes("❯") && line.includes("img/text")),
        );
        app.stdin.write("\r");
      }
      await app.waitFor(() =>
        app.screen().join("\n").includes("img/text does not accept images; they will be omitted"),
      );
      expect(
        app
          .screen()
          .join("\n")
          .match(/does not accept images/g),
      ).toHaveLength(1);
      expect(app.calls).toHaveLength(0);
    } finally {
      await app.cleanup();
    }
  },
);

test("a hand-typed image token stays a model argument and does not imply attached images", async () => {
  const app = await startImages("vision");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("/model [Image #1]\r");
    await app.waitFor(() => app.screen().join("\n").includes('Unknown model "[Image #1]"'));
    expect(app.screen().join("\n")).not.toContain("does not accept images");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("Chinese paste copy and independent notice timers survive draft rerenders", async () => {
  const app = await startImages("text", "zh_CN.UTF-8", 80, 24, true);
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() =>
      app.screen().join("\n").includes("img/text 不接受图片，发送时会省略图片"),
    );
    expect(app.screen().join("\n")).toContain("已粘贴图片 [Image #1]");
    app.stdin.write("more text");
    await app.waitFor(() => !app.screen().join("\n").includes("已粘贴图片"), 3500);
    expect(app.screen().join("\n")).toContain("img/text 不接受图片，发送时会省略图片");
    await app.waitFor(() => !app.screen().join("\n").includes("不接受图片"), 3500);
    expect(app.screen().join("\n")).toContain("❯ [Image #1] more text");
  } finally {
    await app.cleanup();
  }
}, 10000);

test("switching a Session without images to a text model does not warn", async () => {
  const app = await startImages("vision");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("/model img/text\r");
    await app.waitFor(() => app.screen().join("\n").includes("Model changed to img/text"));
    expect(app.screen().join("\n")).not.toContain("does not accept images");
  } finally {
    await app.cleanup();
  }
});

test("read-produced transcript images also cause a model switch warning", async () => {
  const app = await startImages("vision");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("read screenshot\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "shot.png" });
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text" }, { type: "image" }],
    });
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/model img/text\r");
    await app.waitFor(() => app.screen().join("\n").includes("does not accept images"));
    expect(
      app
        .screen()
        .join("\n")
        .match(/does not accept images/g),
    ).toHaveLength(1);
  } finally {
    await app.cleanup();
  }
});

test.each([12, 24])(
  "image notices own their rows beside Goal, Todo and Subagent panels at 40×%i",
  async (rows) => {
    const app = await startImages("text", "en_US.UTF-8", 40, rows);
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("Work until release is verified\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("create_goal", { objective: "Release verification", max_goal_rounds: 2 });
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.tool("todo_write", {
        todos: [{ content: "Keep dock visible", status: "in_progress" }],
      });
      await app.waitFor(() => app.calls.length === 3);
      app.calls[2]!.tool("subagent", { description: "Check release", prompt: "child release" });
      await app.waitFor(() => app.screen().some((line) => /[▸▾] Subagents/.test(line)));
      app.stdin.write(paste(`${app.root}/shot.png`));
      await app.waitFor(() => app.screen().join("\n").includes("does not accept images"));
      const lines = app.screen();
      const goal = lines.findIndex((line) => line.includes("🎯 Release verif"));
      const todo = lines.findIndex((line) => /[▸▾] ✓ 0\/1/.test(line));
      const child = lines.findIndex((line) => /[▸▾] Subagents/.test(line));
      const pasted = lines.findIndex((line) => line.includes("Pasted image [Image #1]"));
      const warning = lines.findIndex((line) => line.includes("does not accept images"));
      const omitted = lines.findIndex((line) => line.includes("will be omitted"));
      const input = lines.findIndex((line) => line.includes("❯ [Image #1]"));
      expect(lines.join("\n")).toContain("🎯 Release verif");
      expect(goal).toBeGreaterThanOrEqual(0);
      expect(todo).toBeGreaterThan(goal);
      expect(child).toBeGreaterThan(todo);
      expect(pasted).toBeGreaterThan(child);
      expect(warning).toBeGreaterThan(pasted);
      expect(omitted).toBeGreaterThan(warning);
      expect(input).toBeGreaterThan(omitted);
      expect(lines.at(-2)).toContain("Ask");
      expect(app.isWorking()).toBe(true);
    } finally {
      await app.cleanup();
    }
  },
);

test("adding an image warning preserves the history reading position and return control", async () => {
  const app = await startImages("text", "en_US.UTF-8", 40, 24, true);
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("long reply\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      Array.from({ length: 50 }, (_, i) => `line-${String(i).padStart(2, "0")}`).join("\n"),
    );
    await app.waitFor(() => app.screen().includes("  line-49"));
    app.stdin.write("\x1b[<64;5;2M");
    await app.waitFor(() => app.screen().some((line) => line.includes("Back to bottom")));
    const first = app.screen()[0];
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => app.screen().join("\n").includes("does not accept images"));
    expect(app.screen()[0]).toBe(first);
    const returnRow = app.screen().findIndex((line) => line.includes("Back to bottom"));
    const pastedRow = app.screen().findIndex((line) => line.includes("Pasted image"));
    expect(returnRow).toBeGreaterThan(0);
    expect(pastedRow).toBeGreaterThan(returnRow);
    const reading = app.screen().slice(0, returnRow - 1);
    expect(reading.at(-1)).toMatch(/line-\d+/);
    app.calls[0]!.delta("\nnew output");
    await app.waitFor(() => app.screen().some((line) => line.includes("New output")));
    expect(app.screen().slice(0, returnRow - 1)).toEqual(reading);
    app.stdin.write("\x1b[1;5F");
    await app.waitFor(() => app.screen().includes("  new output"));
    expect(app.screen().join("\n")).not.toContain("Back to bottom");
  } finally {
    await app.cleanup();
  }
});
