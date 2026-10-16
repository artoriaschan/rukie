import { UiLocaleProvider } from "../../src/lib/i18n";
import { modelServicesFixture } from "../helpers/model-services";
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
    expect(getComputedStyle(trigger.element()).cursor).toBe("pointer");
    for (const child of trigger.element().querySelectorAll("svg, span")) {
      expect(getComputedStyle(child).cursor).toBe("pointer");
    }
    expect(baseline.height).toBe(28);
    trigger.element().focus();
    await userEvent.keyboard("{Space}");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    expect(getComputedStyle(trigger.element()).boxShadow).toContain("2px");
    await userEvent.keyboard("{Enter}");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
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
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
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
          ...Array.from({ length: 40 }, (_, index) => [
            {
              role: "user",
              entryId: `older-user-${index}`,
              timestamp: index,
              content: `Older question ${index}`,
            },
            {
              role: "assistant",
              entryId: `older-answer-${index}`,
              timestamp: index,
              content: [{ type: "text", text: `Older answer ${index}` }],
            },
          ]).flat(),
          { role: "user", entryId: "u", timestamp: 100, content: "Historical command" },
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
              card: "diff",
              kind: "edit",
              diffs: [{ path: "changes.ts", oldText: "before\n", newText: "after\n" }],
              outputRef: { id: "historical-ref" },
            },
          },
        ],
      }),
    });
    await screen.getByRole("button", { name: "Jump to response 41", exact: true }).click();
    await screen.getByRole("button", { name: "Ran commands · Failed", exact: true }).click();
    const diff = screen.getByRole("button", { name: /changes.ts/ });
    await expect.element(diff).toHaveAttribute("aria-expanded", "true");
    await diff.click();
    await screen.getByRole("button", { name: "Read full output", exact: true }).click();
    await expect.element(screen.getByText("historical full output", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "Jump to response 1", exact: true }).click();
    await expect.element(screen.getByText("Older answer 0", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("article", { name: "Response 41", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Jump to response 41", exact: true }).click();
    await expect.element(screen.getByText("historical full output", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Show summary", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Show summary", exact: true }).click();
    await expect.element(diff).toHaveAttribute("aria-expanded", "false");
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

test("Trace detail separates safe parameters and empty results without an internal vertical scroll trap", async () => {
  await page.viewport(420, 480);
  const command = "printf " + "a-long-readable-command-".repeat(18);
  const output = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
  const screen = await render(
    <ToolRow
      tool={{
        ...tool,
        args: { apiKey: "private-secret" },
        callView: { card: "terminal", kind: "execute", command },
        output,
        resultView: { card: "terminal", kind: "execute", output },
      }}
    />,
  );
  try {
    await expect.element(screen.getByText("Parameters", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Result", { exact: true })).toBeVisible();
    const trigger = screen.getByRole("button", { name: new RegExp("^printf.*Failed") }).element();
    expect(trigger.getBoundingClientRect().height).toBeGreaterThan(28);
    const region = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    expect(region.getBoundingClientRect().height).toBeGreaterThan(1000);
    const scrollOwners = [...region.querySelectorAll<HTMLElement>("*")].filter(
      (node) =>
        /auto|scroll/.test(getComputedStyle(node).overflowY) &&
        node.scrollHeight > node.clientHeight,
    );
    expect(scrollOwners).toHaveLength(0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(420);
    expect(document.body.textContent).not.toContain("private-secret");
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test.each([
  {
    status: "success" as const,
    resultView: { card: "terminal" as const, kind: "execute" as const, output: "" },
    notice: "No output returned",
  },
  { status: "cancelled" as const, resultView: undefined, notice: "No output received" },
])("empty and missing output remain distinct: $notice", async ({ status, resultView, notice }) => {
  const screen = await render(<ToolRow tool={{ ...tool, status, output: "", resultView }} />);
  try {
    const trigger = screen.getByRole("button", { name: /long command Ran command/ });
    if (status === "cancelled") {
      await expect
        .element(trigger)
        .toHaveAccessibleName("long command Ran command Tool outcome is unknown");
    }
    await trigger.click();
    await expect.element(screen.getByText(notice, { exact: true })).toBeVisible();
  } finally {
    await screen.unmount();
  }
});

test("long typed diffs use Transcript vertical scrolling", async () => {
  const screen = await render(
    <ToolRow
      tool={{
        ...tool,
        resultView: {
          card: "diff",
          kind: "edit",
          diffs: [{ path: "large.ts", oldText: "", newText: "added line\n".repeat(80) }],
        },
      }}
    />,
  );
  try {
    const diff = screen.getByRole("button", { name: /large.ts/ });
    await expect.element(diff).toBeVisible();
    const viewport = screen.getByText("File changes", { exact: true }).element()
      .parentElement!.parentElement!;
    await expect.poll(() => viewport.getBoundingClientRect().height).toBeGreaterThan(1000);
  } finally {
    await screen.unmount();
  }
});

test("Chinese Trace remains readable at enlarged scale in a narrow low Dark viewport", async () => {
  await page.viewport(420, 480);
  await commands.reducedMotion(true);
  document.documentElement.classList.add("dark");
  document.documentElement.style.setProperty("--ui-font-size", "18px");
  const screen = await render(
    <UiLocaleProvider locale="zh">
      <ToolRow
        tool={{
          ...tool,
          callView: { card: "terminal", kind: "execute", command: "长命令与路径/".repeat(35) },
        }}
      />
    </UiLocaleProvider>,
  );
  try {
    await expect.element(screen.getByText("参数", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("返回结果", { exact: true })).toBeVisible();
    const trigger = screen.getByRole("button", { name: /长命令与路径.*失败/ }).element();
    expect(trigger.getBoundingClientRect().height).toBeGreaterThan(28);
    expect(getComputedStyle(trigger).fontSize).toBe("17px");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(420);
    const summary = screen.getByText("summary", { exact: true }).element();
    expect(getComputedStyle(summary).userSelect).not.toBe("none");
  } finally {
    await screen.unmount();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.removeProperty("--ui-font-size");
    await commands.reducedMotion(false);
    await page.viewport(1280, 900);
  }
});

test("an invalid typed diff reports rendering failure and preserves the received patch", async () => {
  const patch = "@@ -1,2 +1,2 @@\n-this source has an invalid hunk count";
  const screen = await render(
    <ToolRow
      tool={{
        ...tool,
        resultView: { card: "diff", kind: "edit", diffs: [{ path: "invalid.ts", patch }] },
      }}
    />,
  );
  try {
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Could not render changes. Original content follows.");
    await expect.element(screen.getByText(patch, { exact: true })).toBeVisible();
  } finally {
    await screen.unmount();
  }
});
