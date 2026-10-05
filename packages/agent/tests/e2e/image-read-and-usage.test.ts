import { expect, test } from "bun:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";

async function seed(messages: AgentMessage[]) {
  const store = new MemorySessionRepo();
  const stored = await store.create({}, BACKGROUND_CONTEXT);
  const branch = await stored.createBranch("main", null, BACKGROUND_CONTEXT);
  for (const message of messages) await branch.appendMessage(message, BACKGROUND_CONTEXT);
  await stored.close(BACKGROUND_CONTEXT);
  return { store, resumeId: stored.metadata.id };
}

test("a 100×100 prompt image adds fourteen estimated tokens to Context Usage and Context Report", async () => {
  const dirs = await tempDirs();
  const bytes = Buffer.from(png, "base64");
  bytes.writeUInt32BE(100, 16);
  bytes.writeUInt32BE(100, 20);
  const fake = fakeModel([fauxAssistantMessage("seen")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    ...(await seed([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
        ],
        timestamp: 1,
      },
    ])),
  });
  try {
    expect(session.contextReport().categories).toContainEqual({ name: "messages", tokens: 15 });
    const events: SessionEvent[] = [];
    await session.run("next", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.find((event) => event.type === "context_usage")?.segments).toMatchObject({
      prompt: 15,
      tools: 0,
    });
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test("read image tokens belong to tools and appear in the live Context Report", async () => {
  const dirs = await tempDirs();
  const bytes = Buffer.from(png, "base64");
  bytes.writeUInt32BE(100, 16);
  bytes.writeUInt32BE(100, 20);
  await Bun.write(`${dirs.cwd}/small.png`, bytes);
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "small.png" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("seen"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    const events: SessionEvent[] = [];
    await session.run("look", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.findLast((event) => event.type === "context_usage")?.segments.tools).toBe(21);
    // Prompt 1 + tool call 7 + read text 7 + image 14 + assistant 1 + environment/skills reminders.
    const report = session.contextReport();
    expect(
      report.categories.find((category) => category.name === "messages")?.tokens,
    ).toBeGreaterThanOrEqual(30);
    await session.dispose();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    try {
      expect(
        resumed.contextReport().categories.find((category) => category.name === "messages")?.tokens,
      ).toBe(report.categories.find((category) => category.name === "messages")?.tokens);
    } finally {
      await resumed.dispose();
    }
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test.each([false, true])(
  "Subagent read shares image results and limits (oversized: %s)",
  async (oversized) => {
    const dirs = await tempDirs();
    const bytes = Buffer.from(png, "base64");
    if (oversized) bytes.writeUInt32BE(8001, 16);
    await Bun.write(`${dirs.cwd}/child.png`, bytes);
    const reply: Parameters<typeof fakeModel>[0][number] = (context) => {
      const child = !context.messages.some(
        (message) =>
          message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
      );
      if (
        child &&
        !context.messages.some(
          (message) => message.role === "toolResult" && message.toolName === "read",
        )
      )
        return fauxAssistantMessage(fauxToolCall("read", { path: "child.png" }), {
          stopReason: "toolUse",
        });
      return fauxAssistantMessage(child ? "child finished" : "parent finished");
    };
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", { description: "Inspect screenshot", prompt: "Read child.png" }),
        { stopReason: "toolUse" },
      ),
      reply,
      reply,
      reply,
      reply,
    ]);
    const session = await createSession({ ...dirs, ...fake });
    try {
      await session.run("delegate the screenshot");
      const result = fake.contexts
        .flatMap((context) => context.messages)
        .find((message) => message.role === "toolResult" && message.toolName === "read");
      expect(result).toMatchObject({ role: "toolResult", isError: oversized });
      if (oversized) {
        expect(JSON.stringify(result)).toContain("8000");
        expect(JSON.stringify(result)).not.toContain('"type":"image"');
      } else {
        expect(result).toMatchObject({
          content: [
            { type: "text", text: "Read image file [image/png]" },
            { type: "image", data: png, mimeType: "image/png" },
          ],
        });
      }
    } finally {
      await session.dispose();
      await dirs.cleanup();
    }
  },
);

test("read keeps pi's BMP omission text without applying PNG/JPEG/GIF/WebP limits", async () => {
  const dirs = await tempDirs();
  const bytes = Buffer.alloc(58);
  bytes.write("BM");
  bytes.writeUInt32LE(58, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeUInt32LE(9000, 18);
  bytes.writeUInt32LE(1, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  await Bun.write(`${dirs.cwd}/image.bmp`, bytes);
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "image.bmp" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("seen"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("read BMP");
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
      isError: false,
      content: [
        {
          type: "text",
          text: "Read image file [image/bmp]\n[Image omitted: configure an imageProcessor to convert BMP images.]",
        },
      ],
    });
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test("provider input usage overrides image estimates without losing image segment attribution", async () => {
  const dirs = await tempDirs();
  const bytes = Buffer.from(png, "base64");
  bytes.writeUInt32BE(100, 16);
  bytes.writeUInt32BE(100, 20);
  const fake = fakeModel([]);
  const session = await createSession({
    ...dirs,
    model: fake.model,
    streamFn: withAuxiliaryRequests(() => {
      const reply = fauxAssistantMessage("seen");
      reply.usage = { ...reply.usage, input: 700, cacheRead: 30, cacheWrite: 20 };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: reply });
      stream.end(reply);
      return stream;
    }),
  });
  try {
    const events: SessionEvent[] = [];
    await session.run("look", {
      images: [{ data: bytes.toString("base64"), mimeType: "image/png" }],
      onEvent: (event) => {
        events.push(event);
      },
    });
    const usage = events.findLast((event) => event.type === "context_usage");
    expect(usage?.used).toBe(750);
    expect(usage?.segments.prompt).toBeGreaterThanOrEqual(15);
    expect(session.contextReport().used).toBe(750);
    expect(
      session.contextReport().categories.find((category) => category.name === "messages")?.tokens,
    ).toBeGreaterThanOrEqual(16);
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test.each([
  ["png", "image/png", png],
  ["gif", "image/gif", "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"],
  [
    "jpeg",
    "image/jpeg",
    Buffer.from(
      "ffd8ffe000104a46494600010100000100010000ffc00011080001000203012200021101031101ffd9",
      "hex",
    ).toString("base64"),
  ],
  [
    "webp",
    "image/webp",
    Buffer.from("524946461600000057454250565038580a00000000000000000000000000", "hex").toString(
      "base64",
    ),
  ],
] as const)("read returns an original %s image block", async (extension, mimeType, data) => {
  const dirs = await tempDirs();
  await Bun.write(`${dirs.cwd}/image.${extension}`, Buffer.from(data, "base64"));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: `image.${extension}` }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("seen"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("read the image");
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
      isError: false,
      content: [
        { type: "text", text: `Read image file [${mimeType}]` },
        { type: "image", data, mimeType },
      ],
    });
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test.each(["large", "unparseable", "zero"])(
  "historical %s images use the 1600-token cap/fallback in prompt and tools",
  async (shape) => {
    const dirs = await tempDirs();
    const bytes = Buffer.from(png, "base64");
    bytes.writeUInt32BE(shape === "zero" ? 0 : 8000, 16);
    bytes.writeUInt32BE(8000, 20);
    const image = {
      type: "image" as const,
      data: shape === "unparseable" ? "broken" : bytes.toString("base64"),
      mimeType: "image/png",
    };
    const fake = fakeModel([fauxAssistantMessage("seen")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      ...(await seed([
        { role: "user", content: [{ type: "text", text: "look" }, image], timestamp: 1 },
        {
          role: "toolResult",
          toolName: "read",
          toolCallId: "historical",
          content: [image],
          isError: false,
          timestamp: 2,
        },
      ])),
    });
    try {
      expect(session.contextReport().categories).toContainEqual({ name: "messages", tokens: 3201 });
      const events: SessionEvent[] = [];
      await session.run("next", {
        onEvent: (event) => {
          events.push(event);
        },
      });
      expect(events.find((event) => event.type === "context_usage")?.segments).toMatchObject({
        prompt: 1601,
        tools: 1600,
      });
    } finally {
      await session.dispose();
      await dirs.cleanup();
    }
  },
);

test("read refuses image byte limits by file magic before the image reaches the model", async () => {
  const dirs = await tempDirs();
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 1);
  Buffer.from(png, "base64").copy(bytes);
  await Bun.write(`${dirs.cwd}/large.data`, bytes);
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "large.data" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    expect((await session.run("read the image")).text).toBe("recovered");
    const result = fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult");
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("5 MB") }],
    });
    expect(JSON.stringify(result)).not.toContain('"type":"image"');
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test.each([
  ["width", 8001, 16],
  ["height", 8001, 20],
  ["zero width", 0, 16],
] as const)("read refuses invalid image %s", async (_side, dimension, offset) => {
  const dirs = await tempDirs();
  const bytes = Buffer.from(png, "base64");
  bytes.writeUInt32BE(dimension, offset);
  await Bun.write(`${dirs.cwd}/dimension.png`, bytes);
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "dimension.png" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("read the image");
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({ isError: true });
    expect(JSON.stringify(fake.contexts[1]!.messages.at(-1))).toContain(
      dimension ? "8000" : "Invalid",
    );
    expect(JSON.stringify(fake.contexts[1]!.messages.at(-1))).not.toContain('"type":"image"');
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});
