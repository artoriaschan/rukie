import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("a question replaces the composer and submits the numbered answer without losing its draft", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const identity = {
    epoch: "question-one",
    requestId: "question-one",
    taskId: 1,
    conversationId: 1,
  };
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
    const draft = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await draft.fill("Keep this draft");
    await send({
      type: "interaction_requested",
      identity,
      request: {
        kind: "question",
        identity,
        toolCallId: "question-call",
        questions: [
          {
            header: "Storage",
            question: "Which storage?",
            options: [
              { label: "SQLite", description: "Local database" },
              { label: "Memory", description: "Temporary data" },
            ],
          },
        ],
      },
    });
    await expect.element(screen.getByRole("region", { name: "Question required" })).toBeVisible();
    await expect.element(draft).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Question required" }).element().getBoundingClientRect()
        .width,
    ).toBeCloseTo(752, 0);
    await userEvent.keyboard("2{Enter}");
    await expect.element(draft).toHaveValue("Keep this draft");
    await expect.element(draft).toHaveFocus();
    const wire = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(wire).toContainEqual(
      expect.objectContaining({
        type: "interaction.reply",
        kind: "question",
        identity,
        reply: { answers: [{ selected: ["Memory"] }] },
      }),
    );
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("mixed interactions keep insertion order, settled questions disappear and plan review blocks the draft", async () => {
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const identity = (epoch: string) => ({ epoch, requestId: epoch, taskId: 1, conversationId: 1 });
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  const question = (epoch: string) =>
    send({
      type: "interaction_requested",
      identity: identity(epoch),
      request: {
        kind: "question",
        identity: identity(epoch),
        toolCallId: epoch,
        questions: [
          {
            header: "Queue",
            question: epoch,
            options: [
              { label: "Yes", description: "Continue" },
              { label: "No", description: "Stop" },
            ],
          },
        ],
      },
    });
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    const draft = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await draft.fill("Queued draft survives");
    await question("First question");
    await question("Second question");
    await send({
      type: "interaction_requested",
      identity: identity("plan"),
      request: {
        kind: "plan_review",
        identity: identity("plan"),
        toolCallId: "plan-call",
        plan: "# Review this plan",
      },
    });
    await send({
      type: "interaction_requested",
      identity: identity("permission"),
      request: {
        kind: "permission",
        identity: identity("permission"),
        toolCallId: "bash-call",
        toolName: "bash",
        args: { command: "ls" },
        mode: "ask",
        sessionAllow: { kind: "tool", rule: "bash" },
      },
    });
    await expect.element(screen.getByRole("heading", { name: "First question" })).toBeVisible();
    await expect
      .element(screen.getByRole("heading", { name: "Second question" }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Skip", exact: true }).click();
    await expect.element(screen.getByRole("heading", { name: "Second question" })).toBeVisible();
    await send({ type: "interaction_settled", identity: identity("Second question") });
    await expect
      .element(screen.getByRole("region", { name: "Question required" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("region", { name: "Permission required" }))
      .not.toBeInTheDocument();
    await expect.element(draft).not.toBeInTheDocument();
    await send({ type: "interaction_settled", identity: identity("plan") });
    await expect.element(screen.getByRole("region", { name: "Permission required" })).toBeVisible();
    await screen.getByRole("button", { name: "Allow", exact: true }).click();
    await expect.element(draft).toHaveValue("Queued draft survives");
    await expect.element(draft).toHaveFocus();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("a failed question reply stays retryable, pending replies disable activation and stale replies settle", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const send = async (path: string, facts?: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facts ?? {}),
    });
  };
  const ask = (epoch: string) => {
    const identity = { epoch, requestId: epoch, taskId: 1, conversationId: 1 };
    return send("message", {
      type: "interaction_requested",
      sessionId: "one",
      identity,
      request: {
        kind: "question",
        identity,
        toolCallId: epoch,
        questions: [
          {
            header: "Retry",
            question: "Continue?",
            options: [
              { label: "Yes", description: "Continue" },
              { label: "No", description: "Stop" },
            ],
          },
        ],
      },
    });
  };
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    const draft = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await draft.fill("Preserve on retry");
    await ask("retry");
    const region = screen.getByRole("region", { name: "Question required" });
    const yes = screen.getByRole("button", { name: /Yes Continue/ });
    await expect.element(region).toBeVisible();
    await send("error", { type: "interaction.reply", code: "internal" });
    await yes.click();
    await expect.element(screen.getByRole("alert")).toBeVisible();
    await expect.element(region).toBeVisible();
    await expect.element(yes).toBeEnabled();
    await send("hold");
    await yes.click();
    await expect.element(region).toHaveAttribute("aria-busy", "true");
    await expect.element(yes).toBeDisabled();
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    await userEvent.keyboard("1{Enter}");
    const wire = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(
      wire.filter((command: { type: string }) => command.type === "interaction.reply"),
    ).toHaveLength(2);
    await send("flush");
    await expect.element(draft).toHaveValue("Preserve on retry");
    await ask("stale");
    await expect.element(region).toBeVisible();
    await send("error", { type: "interaction.reply", code: "interaction_stale" });
    await yes.click();
    await expect.element(region).not.toBeInTheDocument();
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(draft).toHaveValue("Preserve on retry");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
