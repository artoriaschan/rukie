import { expect, test } from "bun:test";
import type { PermissionAskRequest } from "@neant/agent";
import { createInteractions } from "../../../../src/tui/screens/chat/interactions";

const request = (
  id: string,
  signal: AbortSignal,
  command = "printf shared",
): PermissionAskRequest => ({
  toolCallId: id,
  toolName: "bash",
  args: { command },
  mode: "ask",
  sessionAllow: { kind: "command", rule: `bash(${command})` },
  signal,
});

test("session permission replies to Core and withdrawn requests leave the FIFO without allowing a different command", async () => {
  const interactions = createInteractions({
    readClipboard: async () => ({ unavailable: true }),
    writeClipboard: async () => false,
    openExternal: async () => {},
  });
  const first = new AbortController();
  const covered = new AbortController();
  const different = new AbortController();
  const firstReply = interactions.askPermission(request("first", first.signal));
  const coveredReply = interactions.askPermission(request("covered", covered.signal));
  const otherReply = interactions.askPermission(
    request("other", different.signal, "printf different"),
  );
  interactions.selectPermission(1);
  interactions.confirmPermission();
  expect(await firstReply).toBe("allow-session");
  expect(interactions.getSnapshot()?.request.toolCallId).toBe("covered");
  covered.abort();
  expect(await coveredReply).toBe("deny");
  expect(interactions.getSnapshot()?.request.toolCallId).toBe("other");
  interactions.denyPermission();
  expect(await otherReply).toBe("deny");
  expect(interactions.getSnapshot()).toBeUndefined();
  const nextReply = interactions.askPermission(request("next", first.signal));
  expect(interactions.getSnapshot()?.request.toolCallId).toBe("next");
  interactions.denyPermission();
  expect(await nextReply).toBe("deny");
});
