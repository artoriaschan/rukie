import { App } from "../../src/app";
import { expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ToolRow } from "../../src/components/tool-row";
import type { TranscriptTool } from "../../src/lib/transcript";
import "../../src/theme.css";

const tool: TranscriptTool = {
  id: "entry:call",
  name: "bash",
  args: {},
  status: "error",
  output: "summary",
  callView: { card: "terminal", kind: "execute", command: "long command" },
  resultView: {
    card: "terminal",
    kind: "execute",
    output: "summary",
    outputUnavailable: true,
    outputRef: { id: "task-7-stream" },
  },
};

test("full output is fetched on demand, byte pages and failed reads remain retryable", async () => {
  await page.viewport(420, 900);
  const read = vi
    .fn()
    .mockResolvedValueOnce({
      stdout: "first output",
      stderr: "diagnostic",
      nextOffset: 22,
      dropped: false,
    })
    .mockRejectedValueOnce(new Error("disconnected"))
    .mockResolvedValueOnce({ stdout: "last output", stderr: "", nextOffset: 33, dropped: false });
  const screen = await render(
    <div className="p-5" style={{ width: "100%" }}>
      <ToolRow tool={tool} readOutput={read} />
    </div>,
  );
  try {
    expect(read).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Read full output", exact: true });
    await expect.element(button).toBeVisible();
    const trigger = screen.getByRole("button", { name: /long command/ });
    const baseline = trigger.element().getBoundingClientRect();
    button.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("first output", { exact: false })).toBeVisible();
    expect(read).toHaveBeenCalledWith({ id: "task-7-stream" }, 0);
    expect(trigger.element().getBoundingClientRect().width).toBeCloseTo(baseline.width);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    await screen.getByRole("button", { name: "Read next page", exact: true }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Could not read output. Try again.");
    await expect.element(screen.getByText("first output", { exact: false })).toBeVisible();
    await screen.getByRole("button", { name: "Read next page", exact: true }).click();
    expect(read).toHaveBeenLastCalledWith({ id: "task-7-stream" }, 22);
    await expect.element(screen.getByText("last output", { exact: false })).toBeVisible();
    await screen.getByRole("button", { name: "Show summary", exact: true }).click();
    await expect.element(screen.getByText("summary", { exact: true })).toBeVisible();
    await trigger.click();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    const region = document.getElementById(trigger.element().getAttribute("aria-controls")!)!;
    expect(region.inert).toBe(true);
    await expect.poll(() => region.getBoundingClientRect().height).toBe(0);
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test("App reads a historical tool reference through the session wire command", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify({
        type: "snapshot",
        sessionId: "one",
        model: "test/script",
        compactions: [],
        queuedInputs: [],
        toolStates: {},
        background: [],
        runSummaries: [],
        messages: [
          { role: "user", entryId: "u", timestamp: 1, content: "Historical command" },
          {
            role: "assistant",
            entryId: "a",
            timestamp: 2,
            content: [
              {
                type: "toolCall",
                id: "call",
                name: "bash",
                arguments: { command: "historical" },
                view: { card: "terminal", kind: "execute", command: "historical" },
              },
            ],
          },
          {
            role: "toolResult",
            entryId: "r",
            timestamp: 3,
            toolCallId: "call",
            toolName: "bash",
            isError: true,
            content: [{ type: "text", text: "bounded output" }],
            view: {
              card: "terminal",
              kind: "execute",
              output: "bounded output",
              outputRef: { id: "historical-ref" },
            },
          },
        ],
      }),
    });
    await screen.getByRole("button", { name: "Ran commands", exact: true }).click();
    await screen.getByRole("button", { name: "Read full output", exact: true }).click();
    await expect.element(screen.getByText("historical full output", { exact: true })).toBeVisible();
    const requests = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_output.read",
          sessionId: "one",
          outputRef: { id: "historical-ref" },
          offset: 0,
          maxBytes: 65536,
        }),
      ]),
    );
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
