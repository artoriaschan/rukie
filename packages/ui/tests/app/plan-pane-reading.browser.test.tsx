import { expect, test } from "vitest";
import { commands, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";
test("wheel reading position survives pane, permission arrival, sidebar close and narrow resize", async () => {
  await page.viewport(1440, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const send = async (facts: object) =>
    fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await send({
      type: "snapshot",
      model: "test/script",
      compactions: [],
      toolStates: {},
      messages: [
        ...Array.from({ length: 25 }, (_, index) => [
          {
            role: "user",
            timestamp: index * 2 + 1,
            entryId: `u${index}`,
            content: `Question ${index}`,
          },
          {
            role: "assistant",
            timestamp: index * 2 + 2,
            entryId: `a${index}`,
            content: [{ type: "text", text: `Answer ${index}` }],
          },
        ]).flat(),
        {
          role: "assistant",
          timestamp: 100,
          entryId: "plan",
          content: [
            {
              type: "toolCall",
              id: "plan",
              name: "exit_plan_mode",
              arguments: { plan: "# Read safely\n\nKeep reading position." },
            },
          ],
        },
      ],
    });
    const feed = screen.getByRole("feed").element();
    await expect
      .element(screen.getByRole("region", { name: "Plan preview: Read safely" }))
      .toBeInTheDocument();
    await screen.getByRole("feed").wheel({ delta: { y: -10000 } });
    await expect
      .element(screen.getByRole("button", { name: "Jump to latest", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("Answer 0", { exact: true })).toBeVisible();
    {
      await screen.getByRole("button", { name: "Session summary", exact: true }).click();
      await screen
        .getByRole("complementary", { name: "Session summary" })
        .getByRole("button", { name: "Read safely", exact: true })
        .click();
      await expect
        .element(screen.getByRole("complementary", { name: "Plan side pane" }))
        .toBeVisible();
    }
    // Transcript measures resized rows in requestAnimationFrame from ResizeObserver.
    // Await that frame and React's following paint before reading final scroll state.
    const measured = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    await measured();
    await expect.element(screen.getByText("Answer 0", { exact: true })).toBeVisible();
    const identity = {
      epoch: "pending-pane",
      requestId: "pending-pane",
      taskId: 1,
      conversationId: 1,
    };
    await send({
      type: "interaction_requested",
      identity,
      request: {
        kind: "permission",
        identity,
        toolCallId: "perm",
        toolName: "bash",
        args: { command: "echo test" },
        mode: "ask",
        reason: "Read workspace",
        sessionAllow: { kind: "tool", rule: "bash" },
      },
    });
    await expect.element(screen.getByText("Read workspace", { exact: true })).toBeVisible();
    await measured();
    expect(feed.scrollTop, "before existing sidebar toggle").toBe(0);
    await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
    await measured();
    expect(feed.scrollTop, "existing sidebar closes after permission").toBe(0);
    await page.viewport(420, 800);
    await expect.element(screen.getByText("Read workspace", { exact: true })).toBeVisible();
    await measured();
    expect(feed.scrollTop, "narrow viewport after permission").toBe(0);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
