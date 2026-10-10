import { expect, test } from "bun:test";
import { requestInteraction } from "../../src/interaction/index.ts";

test("a notification that synchronously cancels an interaction returns cancellation without requesting a reply", async () => {
  const controller = new AbortController();
  const reply = Promise.withResolvers<"allow">();
  let requests = 0;
  const interaction = requestInteraction(
    { signal: controller.signal },
    async () => {
      requests++;
      return reply.promise;
    },
    "deny" as const,
    {
      notification: {
        notification_type: "permission_prompt",
        title: "Permission required",
        message: "Approve bash",
      },
      notify: () => controller.abort(),
    },
  );
  try {
    const result = await interaction;
    expect(result).toBe("deny");
    expect(requests).toBe(0);
  } finally {
    reply.resolve("allow");
    await interaction;
  }
});
