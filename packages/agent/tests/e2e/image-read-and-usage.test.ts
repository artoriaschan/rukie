import { expect, test } from "bun:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {
  createSession as createNativeSession,
  ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Message } from "@earendil-works/pi-ai";
import { createSession, createJsonlStore, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { withAuxiliaryRequests, withModelStream } from "../helpers/auxiliary-model.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";

test("read rejects oversized JPEG bytes even when its header cannot provide dimensions", async () => {
  const dirs = await tempDirs();
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 1);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  await Bun.write(`${dirs.cwd}/broken.jpg`, bytes);
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "broken.jpg" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("read the broken JPEG");
    const result = session.messages.find((message) => message.role === "toolResult");
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("5 MB") }],
    });
    expect(JSON.stringify(fake.contexts[1])).not.toContain('"type":"image"');
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test.each([
  ["JPEG", Buffer.from("ffd8ffe00000", "hex"), false],
  ["WebP", Buffer.from("52494646ffffffff57454250", "hex"), false],
  ["oversized WebP", Buffer.from("52494646ffffffff57454250", "hex"), true],
  ["GIF", Buffer.from("GIF89a"), false],
  ["PNG", Buffer.from(png, "base64").subarray(0, 16), false],
] as const)(
  "read validates native-supported %s signatures with unparseable dimensions",
  async (_format, header, oversized) => {
    const dirs = await tempDirs();
    const bytes = oversized ? Buffer.alloc(5 * 1024 * 1024 + 1) : Buffer.from(header);
    header.copy(bytes);
    await Bun.write(`${dirs.cwd}/broken.data`, bytes);
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("read", { path: "broken.data" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("recovered"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    try {
      await session.run("read the broken image");
      expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining(oversized ? "5 MB" : "Invalid") }],
      });
      expect(JSON.stringify(fake.contexts[1])).not.toContain('"type":"image"');
    } finally {
      await session.close();
      await dirs.cleanup();
    }
  },
);

test.each(["APNG", "JPEG-LS", "PNG signature only"])(
  "read retains pi's text behavior for %s",
  async (format) => {
    const dirs = await tempDirs();
    const pngBytes = Buffer.from(png, "base64");
    pngBytes.writeUInt32BE(8001, 16);
    const bytes =
      format === "APNG"
        ? Buffer.concat([
            pngBytes.subarray(0, 33),
            Buffer.from("000000086163544c000000010000000000000000", "hex"),
            pngBytes.subarray(33),
          ])
        : format === "JPEG-LS"
          ? Buffer.from("ffd8fff70000", "hex")
          : pngBytes.subarray(0, 8);
    await Bun.write(`${dirs.cwd}/native-text.data`, bytes);
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("read", { path: "native-text.data" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("read text"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    try {
      await session.run("read the file");
      expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
        isError: false,
      });
      expect(JSON.stringify(fake.contexts[1])).not.toContain('"type":"image"');
    } finally {
      await session.close();
      await dirs.cleanup();
    }
  },
);

async function seed(dirs: Awaited<ReturnType<typeof tempDirs>>, messages: Message[]) {
  const session = await createSession({ ...dirs, ...fakeModel([]) });
  const resumeId = session.id;
  await session.close();
  const store = createJsonlStore(dirs);
  const lease = await store.open({ id: resumeId }, BACKGROUND_CONTEXT);
  const kernel = createNativeSession(lease.storage);
  try {
    await kernel.commit(async (tx) => {
      await tx.appendEntry(ROOT_CONVERSATION_ID, {
        kind: "test.historical-image",
        data: {},
        model: messages,
      });
    }, BACKGROUND_CONTEXT);
  } finally {
    await kernel.close(BACKGROUND_CONTEXT);
    await lease.release();
  }
  return { resumeId };
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
    ...(await seed(dirs, [
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
    expect(
      events.find((event) => event.type === "context_usage")!.segments.prompt,
    ).toBeGreaterThanOrEqual(16);
  } finally {
    await session.close();
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
    const usage = events.filter((event) => event.type === "context_usage");
    expect(usage.at(-1)!.segments.tools - usage[0]!.segments.tools).toBe(21);
    // Prompt 1 + tool call 7 + read text 7 + image 14 + assistant 1 + environment/skills reminders.
    const report = session.contextReport();
    expect(
      report.categories.find((category) => category.name === "messages")?.tokens,
    ).toBeGreaterThanOrEqual(30);
    await session.close();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    try {
      expect(
        resumed.contextReport().categories.find((category) => category.name === "messages")?.tokens,
      ).toBe(report.categories.find((category) => category.name === "messages")?.tokens);
    } finally {
      await resumed.close();
    }
  } finally {
    await session.close();
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
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Inspect screenshot",
          prompt: "Read child.png",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("read", { path: "child.png" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("child finished"),
      fauxAssistantMessage("parent finished"),
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
      await session.close();
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
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
      isError: false,
      content: [
        {
          type: "text",
          text: "Read image file [image/bmp]\n[Image omitted: configure an imageProcessor to convert BMP images.]",
        },
      ],
    });
  } finally {
    await session.close();
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
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(() => {
        const reply = fauxAssistantMessage("seen");
        reply.usage = { ...reply.usage, input: 700, cacheRead: 30, cacheWrite: 20 };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: "stop", message: reply });
        stream.end(reply);
        return stream;
      }),
    ),
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
    await session.close();
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
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
      isError: false,
      content: [
        { type: "text", text: `Read image file [${mimeType}]` },
        { type: "image", data, mimeType },
      ],
    });
  } finally {
    await session.close();
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
      ...(await seed(dirs, [
        { role: "user", content: [{ type: "text", text: "look" }, image], timestamp: 1 },
        fauxAssistantMessage(
          { type: "toolCall", id: "historical", name: "read", arguments: {} },
          { stopReason: "toolUse" },
        ),
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
      expect(session.contextReport().categories).toContainEqual({ name: "messages", tokens: 3203 });
      const events: SessionEvent[] = [];
      await session.run("next", {
        onEvent: (event) => {
          events.push(event);
        },
      });
      expect(
        events.find((event) => event.type === "context_usage")!.segments.prompt,
      ).toBeGreaterThanOrEqual(1602);
      const declarations = session
        .contextReport()
        .categories.find((category) => category.name === "system-tools")!.tokens;
      expect(
        events.find((event) => event.type === "context_usage")!.segments.tools - declarations,
      ).toBe(1600);
    } finally {
      await session.close();
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
    await session.close();
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
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({ isError: true });
    expect(
      JSON.stringify(
        fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
      ),
    ).toContain(dimension ? "8000" : "Invalid");
    expect(
      JSON.stringify(
        fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
      ),
    ).not.toContain('"type":"image"');
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});
