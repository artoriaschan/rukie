import { expect, test } from "bun:test";
import type { WireCommand } from "@rukie/shared";
import { parseWireCommand } from "../src/index.ts";

test("wire validates an input request and rejects unknown commands and excess fields", () => {
  expect(parseWireCommand({ id: "1", type: "projects.list" })).toEqual({
    id: "1",
    type: "projects.list",
  });
  expect(
    parseWireCommand({ id: "1", type: "prompt", sessionId: "s", text: "hello" }),
  ).toBeDefined();
  expect(parseWireCommand({ id: "1", type: "prompt", sessionId: "s" })).toBeUndefined();
  expect(parseWireCommand({ id: "1", type: "projects.list", token: "secret" })).toBeUndefined();
  expect(parseWireCommand({ id: "1", type: "unknown" })).toBeUndefined();
});

test("wire preserves an optional image name in prompt input", () => {
  const command: WireCommand = {
    id: "image-1",
    type: "prompt",
    sessionId: "s",
    text: "describe",
    images: [{ data: "base64", mimeType: "image/png", name: "screenshot.png" }],
  };
  expect(parseWireCommand(command)).toEqual(command);
});

test("Goal commands accept text or images without weakening ordinary input validation", () => {
  const image = { data: "base64", mimeType: "image/png", name: "target.png" };
  const create = { id: "goal", type: "session.create", project: null } as const;
  const existing = { id: "goal", type: "session.goal_create", sessionId: "s" } as const;
  for (const base of [{ ...create, goal: true as const }, existing]) {
    for (const input of [{ text: "target" }, { text: "", images: [image] }]) {
      const command = { ...base, ...input };
      expect(parseWireCommand(command)).toEqual(command);
    }
    for (const input of [
      { text: "" },
      { text: "", images: [] },
      { text: "", images: [{ ...image, secret: "extra" }] },
      { text: "target", extra: true },
    ])
      expect(parseWireCommand({ ...base, ...input })).toBeUndefined();
  }
  expect(parseWireCommand({ ...create, text: "hello" })).toBeDefined();
  expect(parseWireCommand({ ...create, text: "", images: [image] })).toBeUndefined();
  expect(parseWireCommand({ ...create, goal: false, text: "target" })).toBeUndefined();
  for (const type of ["session.goal_pause", "session.goal_resume", "session.goal_clear"] as const) {
    const command = { id: "goal", type, sessionId: "s" };
    expect(parseWireCommand(command)).toEqual(command);
    expect(parseWireCommand({ id: "goal", type })).toBeUndefined();
    expect(parseWireCommand({ ...command, text: "extra" })).toBeUndefined();
  }
});

test("model service wire accepts bounded plaintext replacement and rejects private ciphertext and extra fields", () => {
  const provider = {
    id: "fixture",
    name: "Fixture",
    api: "openai-completions",
    baseUrl: "",
    models: [],
  };
  for (const credential of [
    { type: "keep" },
    { type: "delete" },
    { type: "replace", value: "fixture-key" },
  ])
    expect(
      parseWireCommand({ id: "1", type: "modelServices.save", provider, credential }),
    ).toBeDefined();
  for (const credential of [
    { type: "replace", ciphertext: "encrypted" },
    { type: "replace", value: "" },
    { type: "replace", value: "x".repeat(65537) },
    { type: "keep", value: "secret" },
  ])
    expect(
      parseWireCommand({ id: "1", type: "modelServices.save", provider, credential }),
    ).toBeUndefined();
  expect(parseWireCommand({ id: "1", type: "modelServices.list" })).toBeDefined();
  expect(parseWireCommand({ id: "1", type: "modelServices.templates" })).toBeUndefined();
  expect(
    parseWireCommand({ id: "1", type: "modelServices.revealKey", providerId: "../../secret" }),
  ).toBeUndefined();
});

test("model service schema validates optional enablement and a closed provider icon", () => {
  const provider = {
    id: "deepseek",
    name: "DeepSeek",
    api: "anthropic-messages",
    baseUrl: "",
    models: [],
    enabled: false,
    icon: "deepseek",
  };
  const save = (provider: unknown) =>
    parseWireCommand({
      id: "1",
      type: "modelServices.save",
      provider,
      credential: { type: "keep" },
    });
  expect(save(provider)).toBeDefined();
  expect(save({ ...provider, enabled: "false" })).toBeUndefined();
  expect(save({ ...provider, icon: "unknown" })).toBeUndefined();
});

test("plan mode commands and discriminated interaction replies validate at the wire boundary", () => {
  const identity = { requestId: "r", taskId: 1, conversationId: 2, epoch: "e" };
  const commands = [
    { type: "session.create", project: null, text: "plan", planMode: true },
    { type: "session.set_plan_mode", sessionId: "s", on: false },
    { type: "interaction.reply", identity, kind: "permission", reply: "allow" },
    {
      type: "interaction.reply",
      identity,
      kind: "question",
      reply: { answers: [{ selected: ["A"], custom: "note" }] },
    },
    { type: "interaction.reply", identity, kind: "question", reply: "declined" },
    {
      type: "interaction.reply",
      identity,
      kind: "plan_review",
      reply: { kind: "revise", feedback: "simplify" },
    },
  ];
  for (const command of commands) {
    const parsed: unknown = parseWireCommand({ id: "1", ...command });
    expect(parsed).toEqual({ id: "1", ...command });
  }
  for (const command of [
    { type: "interaction.reply", identity, reply: "allow" },
    { type: "interaction.reply", identity, kind: "permission", reply: "declined" },
    {
      type: "interaction.reply",
      identity,
      kind: "question",
      reply: { answers: [{ selected: [1] }] },
    },
    { type: "interaction.reply", identity, kind: "plan_review", reply: { kind: "revise" } },
    {
      type: "interaction.reply",
      identity,
      kind: "plan_review",
      reply: { kind: "approve", outputRef: { id: "task-26-result" } },
    },
    {
      type: "interaction.reply",
      identity,
      kind: "plan_review",
      reply: { kind: "revise", feedback: "", outputRef: { id: "task-26-result" } },
    },
  ])
    expect(parseWireCommand({ id: "1", ...command })).toBeUndefined();
});
