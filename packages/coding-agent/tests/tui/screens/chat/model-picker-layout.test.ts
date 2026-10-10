import { afterEach, expect, test } from "bun:test";
import { startWithClock as start } from "../../helpers/clock-app";

const originalKey = process.env.RUKIE_LAYOUT_TUI_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.RUKIE_LAYOUT_TUI_KEY;
  else process.env.RUKIE_LAYOUT_TUI_KEY = originalKey;
});
const settings = {
  model: "alpha/first",
  thinking: "low",
  providers: ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"].map((id) => ({
    id,
    api: "openai-completions",
    baseUrl: "http://localhost:1/v1",
    apiKeyEnv: "RUKIE_LAYOUT_TUI_KEY",
    models: ["first", "second", "third", "fourth"].map((model) => ({
      id: model,
      reasoning: true,
    })),
  })),
};
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");
async function launch() {
  process.env.RUKIE_LAYOUT_TUI_KEY = "test-key";
  return start([], {
    env: { LANG: "en_US.UTF-8" },
    session: { model: undefined },
    prepare: (root) =>
      Bun.write(`${root}/.rukie/settings.json`, JSON.stringify(settings)).then(() => {}),
  });
}

test("model picker degrades at 80×24, 60×16 and 40×12 and recenters visible strips on resize", async () => {
  const app = await launch();
  try {
    await app.waitFor(() => screen(app).includes("alpha/first"));
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("[low]"));
    expect(screen(app)).toContain("Reasoning");
    app.resize(60, 16);
    await app.waitFor(() => app.screen().length === 16 && screen(app).includes("[low]"));
    expect(screen(app)).toContain("Enter · Esc");
    expect(screen(app)).toContain("Text input · Reasoning");
    expect(screen(app)).not.toContain("adjust thinking; Enter confirms");
    app.resize(40, 12);
    await app.waitFor(() => screen(app).includes("Enter · Esc"));
    expect(screen(app)).not.toContain("Text input · Reasoning");
    expect(screen(app)).toContain("[low]");
    expect(screen(app)).toContain("└");
    expect(app.screen().at(-2)).toContain("Ask ·");
    expect(screen(app)).toContain("›");
    app.stdin.write("\t\t\t\t\t\t");
    await app.waitFor(() => screen(app).includes("[zeta]"));
    expect(screen(app)).toContain("‹");
    app.stdin.write("\x1b[C\x1b[C\x1b[C");
    await app.waitFor(() => screen(app).includes("[high]"));
    expect(screen(app)).toContain("‹");
    app.resize(80, 24);
    await app.waitFor(() => screen(app).includes("Reasoning") && screen(app).includes("[zeta]"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("Select model"));
    expect(app.screen().at(-2)).toContain("first");
  } finally {
    await app.cleanup();
  }
});

function click(app: Awaited<ReturnType<typeof start>>, text: string) {
  const y = app.screen().findIndex((line) => line.includes(text));
  expect(y).toBeGreaterThanOrEqual(0);
  const x = Bun.stringWidth(app.screen()[y]!.slice(0, app.screen()[y]!.indexOf(text))) + 1;
  app.stdin.write(`\x1b[<0;${x};${y + 1}M\x1b[<0;${x};${y + 1}m`);
}

test("mouse tabs, thinking cells, model rows and wheel use the latest picker focus", async () => {
  const app = await launch();
  try {
    await app.waitFor(() => screen(app).includes("alpha/first"));
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("[alpha]"));
    click(app, "beta");
    await app.waitFor(() => screen(app).includes("[beta]"));
    click(app, "high");
    await app.waitFor(() => screen(app).includes("[high]"));
    expect(app.screen().at(-2)).toContain("low");
    const y = app.screen().findIndex((line) => line.includes("beta/first")) + 1;
    app.stdin.write(`\x1b[<65;8;${y}M`);
    await app.waitFor(() => screen(app).includes("❯ fourth beta/fourth"));
    expect(screen(app)).toContain("❯ fourth beta/fourth");
    click(app, "beta/fourth");
    await app.waitFor(
      () => !screen(app).includes("Select model") && !!app.screen().at(-2)?.includes("fourth"),
    );
    expect(app.screen().at(-2)).toContain("high");
    await app.waitFor(() => screen(app).includes("Model changed to fourth (beta/fourth)"));
    app.stdin.write("question\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(app.calls[0]!.model.id).toBe("fourth");
    expect(app.calls[0]!.reasoning).toBe("high");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("picker close and resize preserve historical reading and bottom follow", async () => {
  const app = await launch();
  try {
    await app.waitFor(() => screen(app).includes("alpha/first"));
    app.stdin.write("question\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      Array.from({ length: 50 }, (_, i) => `line-${String(i).padStart(2, "0")}`).join("\n"),
    );
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && screen(app).includes("line-49"));
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("Select model"));
    app.resize(40, 12);
    await app.waitFor(() => screen(app).includes("Enter · Esc"));
    app.resize(80, 24);
    await app.waitFor(() => screen(app).includes("Reasoning"));
    app.stdin.write("\x1b");
    await app.waitFor(
      () => !screen(app).includes("Select model") && screen(app).includes("line-49"),
    );
    expect(screen(app)).not.toContain("Back to bottom");
    app.stdin.write("\x1b[<64;5;2M");
    await app.waitFor(() => screen(app).includes("Back to bottom"));
    const before = app.screen().slice(0, 5);
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("Select model"));
    app.resize(60, 16);
    await app.waitFor(() => screen(app).includes("Enter · Esc"));
    app.resize(80, 24);
    await app.waitFor(() => screen(app).includes("Reasoning"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("Select model"));
    expect(app.screen().slice(0, 5)).toEqual(before);
    expect(screen(app)).toContain("Back to bottom");
  } finally {
    await app.cleanup();
  }
});
