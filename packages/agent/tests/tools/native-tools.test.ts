import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Harness, MemoryStorage, createRegistry } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createPresentedFileTools } from "../../src/tools/file-diffs.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { createBashTool } from "../../src/tools/bash/index.ts";
import { createJobs } from "../../src/tools/jobs/index.ts";
import { createImageReadTool } from "../../src/tools/read.ts";
import { preserveErrorDetails } from "../../src/tools/support/runtime.ts";

test("native file tools write, edit and preserve result diffs", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "~/native.txt", content: "first" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("edit", {
        path: "~/native.txt",
        edits: [{ oldText: "first", newText: "second" }],
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("saved"),
  ]);
  const registry = createRegistry();
  registry.install({ name: "files", tools: createPresentedFileTools(dirs.cwd, dirs.homeDir) });
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry, env: () => new NodeExecutionEnv({ cwd: dirs.cwd }) },
    BACKGROUND_CONTEXT,
  );
  try {
    const conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    const input = await conversation.submit(
      { type: "input", content: "save file" },
      BACKGROUND_CONTEXT,
    );
    expect((await input.wait(BACKGROUND_CONTEXT)).status).toBe("done");
    expect(await Bun.file(`${dirs.homeDir}/native.txt`).text()).toBe("second");
    const context = await conversation.context(BACKGROUND_CONTEXT);
    const results = context.messages.filter((message) => message.role === "toolResult");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      isError: false,
      details: { oldText: null, newText: "first" },
    });
    expect(results[1]).toMatchObject({
      isError: false,
      details: { path: `${dirs.homeDir}/native.txt` },
    });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await dirs.cleanup();
  }
});

test("native read admits image bytes and reports coded image validation failures", async () => {
  const dirs = await tempDirs();
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";
  await Bun.write(`${dirs.cwd}/image.png`, Buffer.from(png, "base64"));
  const oversized = Buffer.from(png, "base64");
  oversized.writeUInt32BE(8001, 16);
  await Bun.write(`${dirs.cwd}/oversized.png`, oversized);
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "image.png" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("read", { path: "oversized.png" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("read image"),
  ]);
  const registry = createRegistry();
  registry.install({
    name: "images",
    tools: [preserveErrorDetails(createImageReadTool(dirs.cwd, dirs.homeDir))],
  });
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry, env: () => new NodeExecutionEnv({ cwd: dirs.cwd }) },
    BACKGROUND_CONTEXT,
  );
  try {
    const conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    const input = await conversation.submit(
      { type: "input", content: "read images" },
      BACKGROUND_CONTEXT,
    );
    expect((await input.wait(BACKGROUND_CONTEXT)).status).toBe("done");
    const results = (await conversation.context(BACKGROUND_CONTEXT)).messages.filter(
      (message) => message.role === "toolResult",
    );
    expect(results[0]).toMatchObject({
      isError: false,
      content: [
        { type: "text", text: "Read image file [image/png]" },
        { type: "image", mimeType: "image/png", data: png },
      ],
    });
    expect(results[1]).toMatchObject({
      isError: true,
      details: { code: "image-dimensions", params: { width: 8001, height: 1, maxPixels: 8000 } },
    });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await dirs.cleanup();
  }
});

test("native Bash retains bounded output and the full spill file", async () => {
  const dirs = await tempDirs();
  const jobs = createJobs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "seq 1 2200", description: "Print numbered lines" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("finished"),
  ]);
  const registry = createRegistry();
  registry.install({ name: "bash", tools: [createBashTool(dirs.cwd, jobs)] });
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry },
    BACKGROUND_CONTEXT,
  );
  try {
    const conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    const input = await conversation.submit(
      { type: "input", content: "print numbered lines" },
      BACKGROUND_CONTEXT,
    );
    // Real child-process completion verifies pipe draining; no guessed timing wait.
    expect((await input.wait(BACKGROUND_CONTEXT)).status).toBe("done");
    const result = (await conversation.context(BACKGROUND_CONTEXT)).messages.find(
      (message) => message.role === "toolResult",
    );
    expect(result).toMatchObject({
      isError: false,
      details: {
        exitCode: 0,
        truncation: { truncated: true, totalLines: 2200, outputLines: 2000 },
      },
    });
    if (
      result?.role !== "toolResult" ||
      typeof result.details !== "object" ||
      result.details === null ||
      !("fullOutputPath" in result.details) ||
      typeof result.details.fullOutputPath !== "string"
    )
      throw new Error("Missing spill path");
    expect(await Bun.file(result.details.fullOutputPath).text()).toStartWith("1\n2\n");
    expect(await Bun.file(result.details.fullOutputPath).text()).toEndWith("2200\n");
    expect(jobs.list()).toEqual([]);
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await jobs.dispose();
    await dirs.cleanup();
  }
});
