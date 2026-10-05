import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";
const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

test.each([
  ["VP8X", "524946461600000057454250565038580a00000000000000000000000000", 24],
  ["VP8L", "5249464612000000574542505650384c050000002f0000000000", 21],
  ["VP8 ", "524946461600000057454250565038200a0000001000009d012a01000100", 26],
] as const)(
  "WebP %s headers support prompt images and dimension limits",
  async (_format, hex, offset) => {
    const dirs = await tempDirs();
    const fake = fakeModel([fauxAssistantMessage("webp")]);
    const session = await createSession({ ...dirs, ...fake });
    const bytes = Buffer.from(hex, "hex");
    try {
      const data = bytes.toString("base64");
      await session.run("webp", { images: [{ data, mimeType: "image/webp" }] });
      expect(fake.contexts[0]!.messages.at(-1)).toMatchObject({
        content: [
          { type: "text", text: "webp" },
          { type: "image", data, mimeType: "image/webp" },
        ],
      });
      bytes.writeUInt16LE(_format === "VP8 " ? 8001 : 8000, offset);
      await expect(
        session.run("bad webp", {
          images: [{ data: bytes.toString("base64"), mimeType: "image/webp" }],
        }),
      ).rejects.toThrow("8000");
    } finally {
      await session.dispose();
      await dirs.cleanup();
    }
  },
);

test("Compaction summarizes prompt text without base64 and resumes into a continuing Run", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("identified the screenshot issue"),
    fauxAssistantMessage("Screenshot issue summary."),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("inspect screenshot", { images: [{ data: png, mimeType: "image/png" }] });
    await session.compact();
    expect(JSON.stringify(fake.contexts[1])).toContain("inspect screenshot");
    expect(JSON.stringify(fake.contexts[1])).not.toContain(png);
    expect(JSON.stringify(session.messages)).toContain("Screenshot issue summary.");
    await session.dispose();
    const next = fakeModel([fauxAssistantMessage("continued")]);
    const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
    try {
      expect((await resumed.run("continue")).text).toBe("continued");
      expect(JSON.stringify(next.contexts[0])).toContain("Screenshot issue summary.");
    } finally {
      await resumed.dispose();
    }
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test.each([
  { data: "not base64!", mimeType: "image/png" },
  { data: Buffer.from("ffd8ffe0ffff", "hex").toString("base64"), mimeType: "image/jpeg" },
  { data: png, mimeType: "image/jpeg" },
])(
  "malformed base64, truncated headers and incorrect MIME claims fail before a request: %j",
  async (image) => {
    const dirs = await tempDirs();
    const fake = fakeModel([]);
    const session = await createSession({ ...dirs, ...fake });
    try {
      await expect(session.run("invalid", { images: [image] })).rejects.toThrow();
      expect(fake.contexts).toHaveLength(0);
      expect(session.running).toBe(false);
    } finally {
      await session.dispose();
      await dirs.cleanup();
    }
  },
);

test("UserPromptSubmit and Session Title receive only prompt text while hook context preserves images", async () => {
  const dirs = await tempDirs();
  await Bun.write(`${dirs.cwd}/submit.sh`, "cat > hook-input.json\necho hook-context\n");
  const fake = fakeModel([fauxAssistantMessage("seen")]);
  const titled = Promise.withResolvers<void>();
  let titleRequest = "";
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "sh submit.sh" }] }] },
    },
    streamFn: withAuxiliaryRequests(fake.streamFn, {
      titles: (model, context, options) => {
        titleRequest = JSON.stringify(context);
        titled.resolve();
        return withAuxiliaryRequests(fake.streamFn)(model, context, options);
      },
    }),
  });
  try {
    await session.run("inspect screenshot", {
      images: [{ data: png, mimeType: "image/png", name: "private.png" }],
    });
    await titled.promise;
    const hookInput = await Bun.file(`${dirs.cwd}/hook-input.json`).text();
    expect(JSON.parse(hookInput).prompt).toBe("inspect screenshot");
    expect(hookInput).not.toContain(png);
    expect(hookInput).not.toContain("private.png");
    expect(titleRequest).toContain("inspect screenshot");
    expect(titleRequest).not.toContain(png);
    expect(titleRequest).not.toContain("private.png");
    expect(JSON.stringify(fake.contexts[0])).toContain(png);
    expect(JSON.stringify(fake.contexts[0])).toContain("hook-context");
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test("Session Resume restores inline images and names and the next request still carries the image", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("seen")]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("look", {
      images: [{ data: png, mimeType: "image/png", name: "saved.png" }],
    });
    await session.dispose();
    const next = fakeModel([fauxAssistantMessage("restored")]);
    const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
    try {
      expect(resumed.messages.find((message) => message.role === "user")).toMatchObject({
        content: [
          { type: "text", text: "look" },
          { type: "image", data: png, mimeType: "image/png" },
        ],
        imageNames: ["saved.png"],
      });
      expect(resumed.checkpoints()[0]?.preview).toBe("look");
      await resumed.run("compare again");
      expect(
        next.contexts[0]!.messages.find(
          (message) =>
            message.role === "user" &&
            Array.isArray(message.content) &&
            message.content.some((part) => part.type === "image"),
        ),
      ).toMatchObject({
        content: [
          { type: "text", text: "look" },
          { type: "image", data: png, mimeType: "image/png" },
        ],
      });
      expect(JSON.stringify(next.contexts[0])).not.toContain("saved.png");
    } finally {
      await resumed.dispose();
    }
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test("steering validates before queueing and sends ordered images with a Skill Invocation", async () => {
  const dirs = await tempDirs();
  await Bun.write(
    `${dirs.cwd}/.neant/skills/check/SKILL.md`,
    "---\nname: check\ndescription: Check images.\n---\nInspect the screenshots carefully.",
  );
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      started.resolve();
      await release.promise;
      return fauxAssistantMessage("first");
    },
    fauxAssistantMessage("steered"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const run = session.run("start");
  try {
    await started.promise;
    expect(() =>
      session.steer("invalid", { images: [{ data: "bm90LWltYWdl", mimeType: "image/png" }] }),
    ).toThrow("image");
    session.steer("/check [Image #2] then [Image #1]", {
      images: [
        { data: png, mimeType: "image/png", name: "two.png" },
        { data: png, mimeType: "image/png" },
      ],
    });
    release.resolve();
    expect((await run).text).toBe("steered");
    const user = fake.contexts[1]!.messages.find(
      (message) =>
        message.role === "user" &&
        Array.isArray(message.content) &&
        message.content[0]?.type === "text" &&
        message.content[0].text.startsWith("/check"),
    )!;
    expect(user.content).toEqual([
      { type: "text", text: "/check [Image #2] then [Image #1]" },
      { type: "image", data: png, mimeType: "image/png" },
      { type: "image", data: png, mimeType: "image/png" },
    ]);
    expect(JSON.stringify(fake.contexts[1])).toContain("Inspect the screenshots carefully.");
    expect(JSON.stringify(fake.contexts[1])).not.toContain("two.png");
    expect(JSON.stringify(fake.contexts[1])).not.toContain("invalid");
    expect(session.messages.findLast((message) => message.role === "user")).toMatchObject({
      imageNames: ["two.png", null],
    });
  } finally {
    release.resolve();
    await run.catch(() => {});
    await session.dispose();
    await dirs.cleanup();
  }
});

test("JPEG headers skip metadata before enforcing image dimensions", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("jpeg")]);
  const session = await createSession({ ...dirs, ...fake });
  // SOI, JFIF APP0, 1×2 SOF0, EOI: pixels are irrelevant to the header-only contract.
  const bytes = Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffc00011080001000203012200021101031101ffd9",
    "hex",
  );
  try {
    const data = bytes.toString("base64");
    await session.run("jpeg", { images: [{ data, mimeType: "image/jpeg" }] });
    expect(fake.contexts[0]!.messages.at(-1)).toMatchObject({
      content: [
        { type: "text", text: "jpeg" },
        { type: "image", data, mimeType: "image/jpeg" },
      ],
    });
    bytes.writeUInt16BE(8001, 25);
    await expect(
      session.run("bad jpeg", {
        images: [{ data: bytes.toString("base64"), mimeType: "image/jpeg" }],
      }),
    ).rejects.toThrow("8000");
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test("GIF prompt images reach the model and their header dimensions enforce the same limit", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("gif")]);
  const session = await createSession({ ...dirs, ...fake });
  const data = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  try {
    await session.run("gif", { images: [{ data, mimeType: "image/gif" }] });
    expect(fake.contexts[0]!.messages.at(-1)).toMatchObject({
      content: [
        { type: "text", text: "gif" },
        { type: "image", data, mimeType: "image/gif" },
      ],
    });
    const large = Buffer.from(data, "base64");
    large.writeUInt16LE(8001, 6);
    await expect(
      session.run("bad gif", {
        images: [{ data: large.toString("base64"), mimeType: "image/gif" }],
      }),
    ).rejects.toThrow("8000");
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test.each(["width", "height"])(
  "image %s over 8000 pixels rejects the entire prompt",
  async (side) => {
    const dirs = await tempDirs();
    const fake = fakeModel([]);
    const session = await createSession({ ...dirs, ...fake });
    try {
      const bytes = Buffer.from(png, "base64");
      bytes.writeUInt32BE(8001, side === "width" ? 16 : 20);
      await expect(
        session.run("big", {
          images: [
            { data: png, mimeType: "image/png" },
            { data: bytes.toString("base64"), mimeType: "image/png" },
          ],
        }),
      ).rejects.toThrow("8000");
      expect(fake.contexts).toEqual([]);
      expect(session.running).toBe(false);
      expect(session.messages.some((message) => message.role === "user")).toBe(false);
    } finally {
      await session.dispose();
      await dirs.cleanup();
    }
  },
);

test("oversized image bytes are rejected before any Run event or model request", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([]);
  const session = await createSession({ ...dirs, ...fake });
  const events: string[] = [];
  session.subscribe((event) => events.push(event.type));
  try {
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 1);
    Buffer.from(png, "base64").copy(bytes);
    await expect(
      session.run("big", { images: [{ data: bytes.toString("base64"), mimeType: "image/png" }] }),
    ).rejects.toThrow("5 MB");
    expect(fake.contexts).toEqual([]);
    expect(events).toEqual([]);
    expect(session.running).toBe(false);
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test("prompt images follow text in caller order while names stay in the Transcript", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("seen")]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("Compare [Image #2] and [Image #1]", {
      images: [
        { data: png, mimeType: "image/png", name: "second.png" },
        { data: gif, mimeType: "image/gif", name: "first.gif" },
      ],
    });
    const prompt = fake.contexts[0]!.messages.findLast((message) => message.role === "user")!;
    expect(prompt.content).toEqual([
      { type: "text", text: "Compare [Image #2] and [Image #1]" },
      { type: "image", data: png, mimeType: "image/png" },
      { type: "image", data: gif, mimeType: "image/gif" },
    ]);
    expect(prompt).not.toHaveProperty("imageNames");
    expect(session.messages.findLast((message) => message.role === "user")).toMatchObject({
      imageNames: ["second.png", "first.gif"],
    });
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test("invalid prompt image is rejected before a Run starts and valid input can still run", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("valid")]);
  const session = await createSession({ ...dirs, ...fake });
  const events: string[] = [];
  session.subscribe((event) => events.push(event.type));
  try {
    await expect(
      session.run("bad", {
        images: [{ data: Buffer.from("not an image").toString("base64"), mimeType: "image/png" }],
      }),
    ).rejects.toThrow("image");
    expect(session.running).toBe(false);
    expect(fake.contexts).toHaveLength(0);
    expect(events).toEqual([]);
    expect(session.messages.some((message) => message.role === "user")).toBe(false);
    expect(
      (await session.run("valid", { images: [{ data: png, mimeType: "image/png" }] })).text,
    ).toBe("valid");
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});
