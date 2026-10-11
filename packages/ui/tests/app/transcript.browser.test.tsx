import { expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import "../../src/theme.css";

test("App shows committed and streaming replies, with failed tool output expanded", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    const user = { role: "user", entryId: "u", timestamp: 1, content: "Repair parser" };
    await send({
      type: "snapshot",
      model: "test/script",
      messages: [user],
      compactions: [],
      queuedInputs: [],
      toolStates: {},
      background: [],
      runSummaries: [],
      run: { inputs: [] },
    });
    await send({
      type: "message_update",
      message: {
        role: "assistant",
        timestamp: 2,
        content: [{ type: "text", text: "Checking **parser**" }],
      },
    });
    await expect.element(screen.getByText("parser", { exact: true })).toBeVisible();
    expect(
      screen
        .getByRole("article", { name: "Response 1", exact: true })
        .element()
        .querySelector(".beui-text-shimmer"),
    ).not.toBeNull();
    const assistant = {
      role: "assistant",
      entryId: "a",
      timestamp: 2,
      content: [
        { type: "text", text: "Checking **parser**" },
        { type: "thinking", thinking: "Checking execution" },
        {
          type: "toolCall",
          id: "call",
          name: "bash",
          arguments: { command: "check" },
          view: { card: "terminal", kind: "execute", command: "check" },
        },
      ],
    };
    await send({ type: "message_end", entryId: "a", messages: [assistant] });
    await expect.element(screen.getByText("Repair parser", { exact: true })).toBeVisible();
    await send({
      type: "tool_execution_start",
      toolCallId: "call",
      toolName: "bash",
      args: { command: "check" },
    });
    await send({
      type: "tool_execution_end",
      toolCallId: "call",
      toolName: "bash",
      result: {
        role: "toolResult",
        timestamp: 3,
        toolCallId: "call",
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "\u001b[38;2;7;14;21mParser failed\u001b[0m" }],
      },
    });
    const result = {
      role: "toolResult",
      entryId: "r",
      timestamp: 3,
      toolCallId: "call",
      toolName: "bash",
      isError: true,
      content: [{ type: "text", text: "\u001b[38;2;7;14;21mParser failed\u001b[0m" }],
    };
    await send({ type: "message_start", message: result });
    await send({ type: "message_end", entryId: "r", messages: [result] });
    await expect.element(screen.getByText("Parser failed", { exact: true })).toBeVisible();
    const tool = screen.getByRole("button", { name: /check Ran command/ }).element();
    const traceRow = tool.closest('[role="listitem"]')!;
    expect(traceRow.querySelectorAll(".lucide-square-terminal")).toHaveLength(1);
    const reasoning = screen.getByRole("button", { name: "Reasoning", exact: true }).element();
    expect(reasoning.getAttribute("aria-expanded")).toBe("false");
    const thinkingIcon = reasoning.closest('[role="listitem"]')!.querySelector(".lucide-sparkles")!;
    const toolIcon = tool.querySelector(".lucide-square-terminal")!;
    expect(thinkingIcon.getBoundingClientRect().left).toBe(toolIcon.getBoundingClientRect().left);
    expect(reasoning.getBoundingClientRect().left).toBe(toolIcon.getBoundingClientRect().right + 8);
    expect(getComputedStyle(reasoning).fontSize).toBe("12px");
    expect(getComputedStyle(tool).fontSize).toBe("12px");
    expect(getComputedStyle(reasoning).color).toBe(
      getComputedStyle(tool.querySelector(".font-mono")!).color,
    );
    expect(tool.getBoundingClientRect().height).toBeCloseTo(28);
    const activity = reasoning.closest('[data-content="trace"]')!;
    const list = activity.querySelector('[role="list"]')!;
    expect(getComputedStyle(list).borderLeftWidth).toBe("0px");
    expect(getComputedStyle(list).paddingLeft).toBe("0px");
    expect(getComputedStyle(list).paddingTop).toBe("4px");
    await userEvent.click(activity.querySelector("button")!);
    expect(activity.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
    expect(getComputedStyle(list).borderLeftWidth).toBe("0px");
    await userEvent.click(activity.querySelector("button")!);

    expect(
      getComputedStyle(screen.getByText("Parser failed", { exact: true }).element()).color,
    ).toBe("rgb(7, 14, 21)");
    await expect.element(screen.getByText("Repair parser", { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("feed")).toHaveAttribute("aria-busy", "true");
    await send({
      type: "message_end",
      entryId: "failure",
      messages: [
        {
          role: "assistant",
          entryId: "failure",
          timestamp: 4,
          content: [],
          stopReason: "error",
          errorMessage: "Provider unavailable",
        },
      ],
    });
    await send({
      type: "result",
      success: false,
      text: "",
      durationMs: 100,
      error: "Provider unavailable",
    });
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Provider unavailable");
    await expect.element(screen.getByRole("feed")).toHaveAttribute("aria-busy", "false");
    expect(
      screen
        .getByRole("article", { name: "Response 1", exact: true })
        .element()
        .querySelector(".beui-text-shimmer"),
    ).toBeNull();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("Run title toggles beUI activity without hiding the streaming or final response", async () => {
  await page.viewport(420, 800);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  try {
    await userEvent.keyboard("{Control>}1{/Control}");
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toBeEnabled();
    await send({
      type: "snapshot",
      model: "test/script",
      compactions: [],
      messages: [{ role: "user", entryId: "u", timestamp: 1000, content: "Repair parser" }],
      run: { inputs: [] },
    });
    const partial = {
      role: "assistant",
      timestamp: 1001,
      content: [
        {
          type: "thinking",
          thinking:
            "Inspecting the parser\n\n" +
            Array.from({ length: 20 }, (_, index) => `Trace line ${index + 1}`).join("\n\n"),
        },
        { type: "text", text: "First **response**" },
      ],
    };
    await send({ type: "message_update", message: partial });
    const response = screen.getByRole("article", { name: "Response 1", exact: true });
    const running = response.getByRole("button", { name: /^Processed for/ });
    await expect.element(running).toHaveAttribute("aria-expanded", "true");
    const reasoning = response.getByRole("button", { name: "Reasoning", exact: true });
    await expect.element(reasoning).toHaveAttribute("aria-expanded", "false");
    const reasoningContent = document.getElementById(
      reasoning.element().getAttribute("aria-controls")!,
    )!;
    expect(reasoningContent.inert).toBe(true);
    expect(reasoningContent.getBoundingClientRect().height).toBe(0);
    await reasoning.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(reasoning).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByText("Inspecting the parser", { exact: true })).toBeVisible();
    expect(response.element().querySelector('[data-state="streaming"]')).not.toBeNull();
    const trace = response.element().querySelector('[data-content="trace"]')!;
    const region = document.getElementById(running.element().getAttribute("aria-controls")!)!;
    const divider = trace.querySelector("hr")!;
    expect(divider.nextElementSibling).toBe(region);
    expect(getComputedStyle(divider).borderTopWidth).not.toBe("0px");
    await expect.poll(() => region.getBoundingClientRect().height).toBeGreaterThan(208);
    await expect.element(screen.getByText("Trace line 20", { exact: true })).toBeVisible();
    expect(
      region.querySelector('[role="list"]')!.getBoundingClientRect().height,
    ).toBeLessThanOrEqual(region.getBoundingClientRect().height);
    expect(
      region.querySelector('[role="list"]')!.getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(region.getBoundingClientRect().top);
    await running.click();
    await expect.element(running).toHaveAttribute("aria-expanded", "false");
    const activity = document.getElementById(running.element().getAttribute("aria-controls")!)!;
    const hiddenTrace = activity.querySelector<HTMLElement>("[data-trace-group]")!;
    expect(hiddenTrace.inert).toBe(true);
    expect(divider.nextElementSibling).toBe(activity);
    expect(getComputedStyle(divider).borderTopWidth).not.toBe("0px");
    await expect.poll(() => hiddenTrace.getBoundingClientRect().height).toBe(0);
    await send({
      type: "message_update",
      message: {
        ...partial,
        content: [partial.content[0], { type: "text", text: "Updated **response**" }],
      },
    });
    await expect.element(screen.getByText("Updated", { exact: false })).toBeVisible();
    await running.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(running).toHaveAttribute("aria-expanded", "true");
    await send({ type: "message_end", entryId: "a", messages: [{ ...partial, entryId: "a" }] });
    await send({ type: "result", success: true, text: "First response", durationMs: 434000 });
    const title = response.getByRole("button", { name: "Time spent 7m 14s", exact: true });
    await expect.element(title).toHaveAttribute("aria-expanded", "false");
    await expect.element(screen.getByText("response", { exact: true })).toBeVisible();
    expect(
      response.element().querySelector('[data-state="complete"][aria-busy="false"]'),
    ).not.toBeNull();
    await title.element().focus();
    await userEvent.keyboard(" ");
    await expect.element(title).toHaveAttribute("aria-expanded", "true");
    await expect
      .element(response.getByRole("button", { name: "Reasoning", exact: true }))
      .toHaveAttribute("aria-expanded", "false");
    await response.getByRole("button", { name: "Reasoning", exact: true }).click();
    await expect.element(screen.getByText("Inspecting the parser", { exact: true })).toBeVisible();
    await expect.poll(() => region.getBoundingClientRect().height).toBeGreaterThan(208);
    expect(divider.nextElementSibling).toBe(region);
    await title.click();
    await expect.element(title).toHaveAttribute("aria-expanded", "false");
    await expect.element(response.getByRole("button", { name: /steps/i })).not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
    await page.viewport(1280, 900);
  }
});

test.each(["aborted", "error"])(
  "restored %s activity stays available behind the localized Run title",
  async (stopReason) => {
    await page.viewport(1280, 900);
    const connection = await commands.startWire();
    const screen = await render(
      <App host={{ getConnection: async () => connection }} locale="zh" />,
    );
    try {
      await screen
        .getByRole("button", { name: /Fix compiler/ })
        .first()
        .click();
      await expect.element(screen.getByRole("button", { name: "上下文用量 25%" })).toBeVisible();
      await fetch(`http://127.0.0.1:${connection.port}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "snapshot",
          sessionId: "one",
          model: "test/script",
          compactions: [],
          messages: [
            { role: "user", entryId: "u", timestamp: 1000, content: "历史问题" },
            {
              role: "assistant",
              entryId: "a",
              timestamp: 435000,
              stopReason,
              content: [
                { type: "thinking", thinking: "历史推理" },
                { type: "text", text: "已保留的回复" },
              ],
            },
          ],
          runSummaries: [{ afterMessage: 1, durationMs: 434000, success: false, endedAt: 435000 }],
        }),
      });
      const title = screen.getByRole("button", {
        name: `${stopReason === "aborted" ? "已中止" : "失败"} 已用时 7分钟 14秒`,
        exact: true,
      });
      await expect.element(title).toHaveAttribute("aria-expanded", "true");
      const reasoning = screen.getByRole("button", { name: "推理", exact: true });
      await expect.element(reasoning).toHaveAttribute("aria-expanded", "false");
      await reasoning.click();
      await expect.element(screen.getByText("历史推理", { exact: true })).toBeVisible();
      await title.click();
      await expect.element(title).toHaveAttribute("aria-expanded", "false");
      await expect.element(screen.getByText("已保留的回复", { exact: true })).toBeVisible();
      expect(
        screen
          .getByText("已保留的回复", { exact: true })
          .element()
          .closest(`[data-state="${stopReason === "error" ? "error" : "complete"}"]`),
      ).not.toBeNull();
      await title.click();
      await expect.element(title).toHaveAttribute("aria-expanded", "true");
      await expect.element(screen.getByText("历史推理", { exact: true })).toBeVisible();
    } finally {
      await screen.unmount();
      await commands.stopWire(connection.port);
    }
  },
);

test("consecutive reasoning and tools form traces separated by persistent assistant messages", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await expect.element(screen.getByRole("button", { name: "Context usage 25%" })).toBeVisible();
    await send({
      type: "snapshot",
      model: "test/script",
      compactions: [],
      run: { inputs: [] },
      messages: [
        { role: "user", entryId: "u", timestamp: 1, content: "Inspect workflow" },
        {
          role: "assistant",
          entryId: "a1",
          timestamp: 2,
          content: [
            { type: "thinking", thinking: "Initial reasoning" },
            { type: "text", text: "I will inspect the workflow." },
            {
              type: "toolCall",
              id: "read",
              name: "read",
              arguments: { path: "ci.yml" },
              view: { card: "generic", kind: "read", title: "ci.yml" },
            },
            { type: "thinking", thinking: "Check related scripts" },
            { type: "text", text: "   " },
            {
              type: "toolCall",
              id: "run",
              name: "bash",
              arguments: { command: "inspect-ci" },
              view: { card: "terminal", kind: "execute", command: "inspect-ci" },
            },
            { type: "text", text: "The workflow needs a closer look." },
          ],
        },
        {
          role: "assistant",
          entryId: "a2",
          timestamp: 3,
          content: [
            { type: "thinking", thinking: "Final analysis" },
            {
              type: "toolCall",
              id: "search",
              name: "grep",
              arguments: { pattern: "failed" },
              view: { card: "generic", kind: "search", title: "Search scripts" },
            },
            { type: "text", text: "The result is ready." },
          ],
        },
      ],
    });
    const response = screen.getByRole("article", { name: "Response 1", exact: true });
    await expect
      .element(response.getByRole("button", { name: "Analysis complete", exact: true }))
      .toBeVisible();
    const traces = response.element().querySelectorAll<HTMLElement>("[data-trace-group]");
    expect(traces).toHaveLength(3);
    expect(traces[0]!.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    expect(traces[1]!.querySelectorAll('[role="listitem"]')).toHaveLength(3);
    expect(traces[2]!.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    const toolsTitle = response.getByRole("button", {
      name: "Read files, Ran commands",
      exact: true,
    });
    await expect.element(toolsTitle).toBeVisible();
    const message = screen.getByText("I will inspect the workflow.", { exact: true }).element();
    expect(message.closest('[role="listitem"]')).toBeNull();
    expect(message.closest("[data-trace-group]")).toBeNull();
    expect(message.closest('[data-state="complete"]')).not.toBeNull();
    expect(
      traces[0]!.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      message.compareDocumentPosition(traces[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const button of response.getByRole("button", { name: "Reasoning", exact: true }).all()) {
      await expect.element(button).toHaveAttribute("aria-expanded", "false");
    }
    await toolsTitle.click();
    await expect.element(toolsTitle).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(screen.getByText("The workflow needs a closer look.", { exact: true }))
      .toBeVisible();
    await toolsTitle.click();
    const pending = {
      role: "assistant",
      timestamp: 4,
      content: [{ type: "thinking", thinking: "Streaming analysis" }],
    };
    await send({ type: "message_update", message: pending });
    await expect
      .element(response.getByRole("button", { name: "Analyzing", exact: true }))
      .toBeVisible();
    await send({
      type: "message_update",
      message: {
        ...pending,
        content: [
          ...pending.content,
          {
            type: "toolCall",
            id: "live",
            name: "bash",
            arguments: { command: "live-inspection" },
            view: { card: "terminal", kind: "execute", command: "live-inspection" },
          },
        ],
      },
    });
    await expect
      .element(response.getByRole("button", { name: "Running commands", exact: true }))
      .toBeVisible();
    await response.getByRole("button", { name: /^Processed for/ }).click();
    for (const trace of traces) expect(trace.inert).toBe(true);
    for (const text of [
      "I will inspect the workflow.",
      "The workflow needs a closer look.",
      "The result is ready.",
    ]) {
      await expect.element(screen.getByText(text, { exact: true })).toBeVisible();
    }
    await send({ type: "result", success: true, text: "The result is ready.", durationMs: 2000 });
    await expect
      .element(response.getByRole("button", { name: "Time spent 2.0s", exact: true }))
      .toHaveAttribute("aria-expanded", "false");
    await expect
      .element(response.getByRole("button", { name: "Message", exact: true }))
      .not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("permission epochs reply by keyboard, stale replies disappear, and queue withdrawal preserves the current draft", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  const identity = (epoch: string) => ({
    epoch,
    requestId: "permission",
    taskId: 1,
    conversationId: 1,
  });
  const ask = async (epoch: string) =>
    send({
      type: "interaction_requested",
      identity: identity(epoch),
      request: {
        identity: identity(epoch),
        toolName: "bash",
        toolCallId: "call",
        args: { command: "ls" },
        mode: "ask",
        reason: "Read workspace",
        sessionAllow: { kind: "tool", rule: "bash" },
      },
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
      messages: [{ role: "user", entryId: "prompt", timestamp: 1, content: "Review workspace" }],
      toolStates: {},
      run: { inputs: [] },
    });
    await ask("first");
    await expect.element(screen.getByRole("region", { name: "Permission required" })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Allow ↵", exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("a");
    await expect
      .element(screen.getByRole("region", { name: "Permission required" }))
      .not.toBeInTheDocument();
    const wire = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(wire).toContainEqual(
      expect.objectContaining({
        type: "interaction.reply",
        identity: identity("first"),
        reply: "allow-session",
      }),
    );
    await expect
      .element(screen.getByText("Permission: Allowed for this Session", { exact: true }))
      .toBeVisible();
    await ask("denied");
    await screen.getByRole("button", { name: "Deny Esc", exact: true }).element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("Permission: Denied", { exact: true })).toBeVisible();
    await ask("offline");
    window.dispatchEvent(new CustomEvent("rukie:connection-change", { detail: "disconnected" }));
    await expect
      .element(screen.getByRole("button", { name: "Allow ↵", exact: true }))
      .toBeDisabled();
    await screen.getByRole("button", { name: "Retry", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toBeEnabled();
    await ask("replayed");
    await expect
      .element(screen.getByRole("button", { name: "Allow ↵", exact: true }))
      .toHaveFocus();
    await send({ type: "interaction_settled", identity: identity("replayed") });
    await ask("cancelled");
    await send({ type: "interaction_settled", identity: identity("cancelled") });
    await expect
      .element(screen.getByRole("region", { name: "Permission required" }))
      .not.toBeInTheDocument();
    await ask("stale");
    await fetch(`http://127.0.0.1:${connection.port}/error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "interaction.reply", code: "interaction_stale" }),
    });
    await screen.getByRole("button", { name: "Allow ↵", exact: true }).click();
    await expect
      .element(screen.getByRole("region", { name: "Permission required" }))
      .not.toBeInTheDocument();
    await send({
      type: "queued_inputs_update",
      items: [{ requestId: "queued", prompt: "Queued draft", images: [] }],
    });
    await screen.getByRole("textbox", { name: "Prompt", exact: true }).fill("Existing draft");
    await screen.getByRole("button", { name: "Send now", exact: true }).click();
    const queuedCommands = await (
      await fetch(`http://127.0.0.1:${connection.port}/commands`)
    ).json();
    expect(queuedCommands).toContainEqual(
      expect.objectContaining({ type: "steer_now", sessionId: "one", requestId: "queued" }),
    );
    await screen.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("Withdrawn draft\n\nExisting draft");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("settled Tool Approval cards stay beside their original calls when provider IDs are reused", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  const command = "first-command " + "long/path/".repeat(35);
  const assistant = (entryId: string, timestamp: number, command: string) => ({
    role: "assistant",
    entryId,
    timestamp,
    content: [
      {
        type: "toolCall",
        id: "reused",
        name: "bash",
        arguments: { command },
        view: { card: "terminal", kind: "execute", command },
      },
    ],
  });
  const ask = async (epoch: string, command: string) => {
    const identity = { epoch, requestId: epoch, taskId: 1, conversationId: 1 };
    await send({
      type: "interaction_requested",
      identity,
      request: {
        identity,
        toolName: "bash",
        toolCallId: "reused",
        args: { command },
        callView: { card: "terminal", kind: "execute", command },
        mode: "ask",
        sessionAllow: { kind: "tool", rule: "bash" },
      },
    });
  };
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await expect.element(screen.getByRole("button", { name: "Context usage 25%" })).toBeVisible();
    await page.viewport(420, 800);
    await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).first().click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toBeEnabled();
    await send({
      type: "snapshot",
      model: "test/script",
      compactions: [],
      messages: [
        { role: "user", entryId: "u", timestamp: 1, content: "Review commands" },
        assistant("first", 10, command),
      ],
      run: { inputs: [] },
    });
    await ask("first-epoch", command);
    await expect
      .element(screen.getByRole("button", { name: "Allow ↵", exact: true }))
      .toBeVisible();
    // New activity arrives while approval is pending; it must not move the earlier request.
    await send({
      type: "message_end",
      entryId: "second",
      messages: [assistant("second", 20, "second-command")],
    });
    await screen.getByRole("button", { name: "Allow for this Session A", exact: true }).click();
    const approval = screen.getByText("Permission: Allowed for this Session", { exact: true });
    await expect.element(approval).toBeVisible();
    await ask("second-epoch", "second-command");
    await screen.getByRole("button", { name: "Deny Esc", exact: true }).click();
    await expect.element(screen.getByText("Permission: Denied", { exact: true })).toBeVisible();
    const approved = approval.element().closest('[data-state="approved"]')!;
    const denied = screen
      .getByText("Permission: Denied", { exact: true })
      .element()
      .closest('[data-state="denied"]')!;
    const first = screen
      .getByRole("button", { name: /first-command/ })
      .element()
      .closest('[role="listitem"]')!;
    const second = screen
      .getByRole("button", { name: /second-command/ })
      .element()
      .closest('[role="listitem"]')!;
    expect(approved.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.compareDocumentPosition(denied) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(denied.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(approved.querySelectorAll("[data-permission-primary]")).toHaveLength(0);
    await userEvent.click(approved.querySelector("button")!);
    const details = approved.querySelector("dd")!;
    await expect.poll(() => details.textContent).toContain(command);
    expect(approved.getBoundingClientRect().right).toBeLessThanOrEqual(
      screen.getByRole("feed").element().getBoundingClientRect().right,
    );
    expect(details.scrollWidth).toBeLessThanOrEqual(details.clientWidth);
    expect(approval.element().getBoundingClientRect().width).toBeGreaterThan(80);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
    await page.viewport(1280, 900);
  }
});

test("virtualized response groups follow streaming height, preserve upward reading, expand and jump by scale", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  const messages = Array.from({ length: 80 }, (_, i) => [
    { role: "user", entryId: `u-${i}`, timestamp: Date.now(), content: `Question ${i + 1}` },
    {
      role: "assistant",
      entryId: `a-${i}`,
      timestamp: Date.now(),
      content: [{ type: "text", text: `Intermediate ${i + 1}` }],
    },
    {
      role: "assistant",
      entryId: `final-${i}`,
      timestamp: Date.now(),
      content: [{ type: "text", text: `Final ${i + 1}` }],
    },
  ]).flat();
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await send({
      type: "snapshot",
      model: "test/script",
      messages,
      compactions: [],
      queuedInputs: [],
      toolStates: {},
      background: [],
      runSummaries: [],
      run: { inputs: [] },
    });
    const feed = screen.getByRole("feed").element();
    await screen.getByRole("button", { name: "Jump to response 80", exact: true }).click();
    await expect.element(screen.getByText("Final 80", { exact: true })).toBeVisible();
    expect(feed.querySelectorAll("article").length).toBeLessThan(15);
    await send({
      type: "message_update",
      message: {
        role: "assistant",
        timestamp: Date.now(),
        content: [
          {
            type: "text",
            text: Array.from({ length: 35 }, (_, i) => `Stream line ${i}`).join("\n\n"),
          },
        ],
      },
    });
    await expect
      .poll(() => feed.scrollHeight - feed.scrollTop - feed.clientHeight)
      .toBeLessThan(60);
    feed.scrollTop = 0;
    await expect
      .element(screen.getByRole("button", { name: "Jump to latest", exact: true }))
      .toBeVisible();
    const before = feed.scrollTop;
    await send({
      type: "message_update",
      message: {
        role: "assistant",
        timestamp: Date.now(),
        content: [{ type: "text", text: "Added while reading\n\n".repeat(80) }],
      },
    });
    await expect
      .element(screen.getByRole("button", { name: "Jump to latest", exact: true }))
      .toBeVisible();
    expect(feed.scrollTop).toBe(before);
    await screen.getByRole("button", { name: "Jump to response 5", exact: true }).click();
    await expect.element(screen.getByText("Final 5", { exact: true })).toBeVisible();
    const response = screen.getByRole("article", { name: "Response 5", exact: true });
    await response.getByRole("button", { name: /^Time spent / }).click();
    await expect.element(screen.getByText("Intermediate 5", { exact: true })).toBeVisible();
    await send({
      type: "tool_state_changed",
      name: "todo",
      value: [{ content: "Review parser", status: "in_progress" }],
    });
    await send({
      type: "tool_state_changed",
      name: "subagents",
      value: [
        {
          id: "child",
          description: "Check parser",
          type: "general",
          active: false,
          latestRun: { outcome: "error" },
        },
      ],
    });
    const width = feed.getBoundingClientRect().width;
    const toggle = screen.getByRole("button", { name: "Session summary", exact: true });
    await toggle.click();
    await expect.element(screen.getByText("Review parser", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Check parser · Failed", { exact: true })).toBeVisible();
    expect(feed.getBoundingClientRect().width).toBeLessThan(width);
    await expect.element(toggle).toHaveFocus();
    await page.viewport(480, 800);
    const summary = screen.getByRole("complementary", { name: "Session summary", exact: true });
    await expect
      .poll(() => summary.element().getBoundingClientRect().width)
      .toBe(feed.getBoundingClientRect().width);
    await userEvent.keyboard("{Escape}");
    await expect.element(summary).not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("an abort response hands queued inputs back to its originating Session after switching to a new chat", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const url = `http://127.0.0.1:${connection.port}`;
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await fetch(`${url}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "run_start", sessionId: "one", inputs: [] }),
    });
    await expect
      .element(screen.getByRole("button", { name: "Stop generating", exact: true }))
      .toBeVisible();
    await fetch(`${url}/hold`);
    await screen.getByRole("button", { name: "Stop generating", exact: true }).click();
    await expect
      .poll(async () =>
        (await (await fetch(`${url}/commands`)).json()).some(
          (command: { type: string }) => command.type === "abort",
        ),
      )
      .toBe(true);
    await screen.getByRole("button", { name: "New chat", exact: true }).click();
    await screen
      .getByRole("textbox", { name: "Prompt", exact: true })
      .fill("New conversation draft");
    await fetch(`${url}/flush`);
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("New conversation draft");
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("Queued draft");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("running elapsed display advances at the virtual one-second deadline", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(1000);
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "snapshot",
        sessionId: "one",
        model: "test/script",
        compactions: [],
        messages: [{ role: "user", entryId: "u", timestamp: 1000, content: "Timed prompt" }],
        run: { inputs: [] },
      }),
    });
    await expect.element(screen.getByText("Processed for 0.0s", { exact: true })).toBeVisible();
    await vi.advanceTimersByTimeAsync(999);
    await expect.element(screen.getByText("Processed for 0.0s", { exact: true })).toBeVisible();
    await vi.advanceTimersByTimeAsync(1);
    await expect.element(screen.getByText("Processed for 1.0s", { exact: true })).toBeVisible();
  } finally {
    await screen.unmount();
    vi.useRealTimers();
    await commands.stopWire(connection.port);
  }
});

test("a pending prompt response preserves newly typed input when the previous Run has finished", async () => {
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await expect.element(prompt).toBeEnabled();
    await fetch(`http://127.0.0.1:${connection.port}/hold`);
    await prompt.fill("Submitted input");
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(async () =>
        (await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json()).some(
          (command: { type: string }) => command.type === "prompt",
        ),
      )
      .toBe(true);
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "result",
        sessionId: "one",
        success: true,
        text: "Complete",
        durationMs: 1,
      }),
    });
    await prompt.fill("Next input");
    await prompt.fill("Submitted input");
    await fetch(`http://127.0.0.1:${connection.port}/flush`);
    await expect
      .element(screen.getByRole("button", { name: "Send prompt", exact: true }))
      .toBeEnabled();
    await expect.element(prompt).toHaveValue("Submitted input");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("new-session creation hands edited input to the created Session without selecting over another chat", async () => {
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await expect.element(prompt).toBeEnabled();
    await fetch(`http://127.0.0.1:${connection.port}/hold`);
    await prompt.fill("Create Session");
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(async () =>
        (await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json()).some(
          (command: { type: string }) => command.type === "session.create",
        ),
      )
      .toBe(true);
    await prompt.fill("Next Session input");
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await fetch(`http://127.0.0.1:${connection.port}/flush`);
    await expect
      .element(screen.getByRole("heading", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await expect.element(prompt).toHaveValue("");
    await screen.getByRole("button", { name: "Create Session", exact: true }).first().click();
    await expect.element(prompt).toHaveValue("Next Session input");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("navigation previews escape the scroll rail and current response stays highlighted after jumping elsewhere", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} />);
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
        messages: [
          { role: "user", entryId: "u1", timestamp: 1, content: "First question" },
          {
            role: "assistant",
            entryId: "a1",
            timestamp: 2,
            content: [{ type: "text", text: "First final reply" }],
          },
          { role: "user", entryId: "u2", timestamp: 3, content: "Current question" },
        ],
        run: { inputs: [] },
        toolStates: {},
      }),
    });
    const current = screen.getByRole("button", { name: "Jump to response 2", exact: true });
    await expect.element(current).toHaveAttribute("aria-current", "location");
    const old = screen.getByRole("button", { name: "Jump to response 1", exact: true });
    await old.click();
    await userEvent.keyboard("{Tab}");
    old.element().focus();
    await expect
      .poll(() => document.querySelector('[data-slot="preview-rail-card"]')?.textContent)
      .toContain("First final reply");
    const card = document.querySelector<HTMLElement>('[data-slot="preview-rail-card"]')!;
    expect(card.getBoundingClientRect().width).toBeGreaterThan(200);
    expect(card.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
    expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth - 8);
    expect(card.getBoundingClientRect().top).toBeGreaterThanOrEqual(8);
    expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight - 8);
    expect(card.closest('[class*="overflow-y-auto"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector('[data-slot="preview-rail-card"]')).toBeNull();
    await expect.element(current).toHaveAttribute("aria-current", "location");
    await expect
      .poll(
        () =>
          current
            .element()
            .querySelector('[data-slot="preview-rail-tick"]')!
            .getBoundingClientRect().width,
      )
      .toBeGreaterThan(40);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
