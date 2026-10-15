import type { WireQuestionRequest } from "@rukie/shared";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { PlanReviewDock } from "../../src/components/plan-review-dock";
import { PlanPreview } from "../../src/components/plan-preview";
import { QuestionDock } from "../../src/components/question-dock";
import { UiLocaleProvider } from "../../src/lib/i18n";
import "../../src/theme.css";

test("C43 headers retain source title scale, trailing step and accessible close geometry", async () => {
  await page.viewport(1280, 900);
  const request: WireQuestionRequest = {
    kind: "question",
    identity: { epoch: "header", conversationId: 1, requestId: "header", taskId: 1 },
    toolCallId: "header",
    origin: { agentId: "child", description: "Researcher" },
    questions: [
      {
        header: "Storage",
        question: "Which storage?",
        options: [{ label: "Local", description: "" }],
      },
      {
        header: "Next",
        question: "Next question?",
        options: [{ label: "Continue", description: "" }],
      },
    ],
  };
  const screen = await render(
    <UiLocaleProvider locale="en">
      <QuestionDock
        request={request}
        connected
        pending={null}
        onReply={() => {}}
        shortcutsEnabled
      />
    </UiLocaleProvider>,
  );
  try {
    const title = screen.getByRole("heading", { name: "Which storage?" }).element();
    const step = screen.getByText("1 / 2", { exact: true }).element();
    const source = screen.getByText("Researcher", { exact: true }).element();
    const close = screen.getByRole("button", { name: "Skip interaction" }).element();
    expect(getComputedStyle(title).fontSize).toBe("16px");
    expect(getComputedStyle(title).lineHeight).toBe("24px");
    expect(getComputedStyle(title).fontWeight).toBe("500");
    expect(source.getBoundingClientRect().right).toBeLessThan(title.getBoundingClientRect().left);
    expect(step.getBoundingClientRect().left - title.getBoundingClientRect().right).toBe(8);
    expect(close.getBoundingClientRect().left - step.getBoundingClientRect().right).toBe(8);
    expect(getComputedStyle(step).fontSize).toBe("12px");
    expect(close.getBoundingClientRect().width).toBe(24);
    expect(close.getBoundingClientRect().height).toBe(24);
    expect(close.querySelector("svg")!.getBoundingClientRect().width).toBe(12);
    await screen.rerender(
      <UiLocaleProvider locale="en">
        <PlanReviewDock
          request={{
            kind: "plan_review",
            identity: request.identity,
            toolCallId: "review",
            plan: "# Migration",
          }}
          connected
          pending={null}
          onReply={() => {}}
          shortcutsEnabled
        />
      </UiLocaleProvider>,
    );
    const planTitle = screen.getByRole("heading", { name: "Execute this plan?" }).element();
    expect(getComputedStyle(planTitle).fontSize).toBe("16px");
    expect(getComputedStyle(planTitle).lineHeight).toBe("24px");
    await page.viewport(420, 700);
    await screen.rerender(
      <UiLocaleProvider locale="en">
        <QuestionDock
          request={{
            ...request,
            questions: request.questions.map((question) => ({
              ...question,
              question:
                "A long question that should wrap and keep the navigation and close action inside the available card",
            })),
          }}
          connected
          pending={null}
          onReply={() => {}}
          shortcutsEnabled
        />
      </UiLocaleProvider>,
    );
    expect(screen.getByRole("heading").element().getBoundingClientRect().height).toBeGreaterThan(
      24,
    );
    expect(
      screen.getByRole("button", { name: "Skip interaction" }).element().getBoundingClientRect()
        .right,
    ).toBeLessThanOrEqual(innerWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test("C40 header keeps compact actions and source insets within the fixed preview", async () => {
  const screen = await render(
    <UiLocaleProvider locale="en">
      <PlanPreview
        submission={{ id: "header-plan", toolId: "plan", title: "Migration", plan: "# Migration" }}
        onExpand={() => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    const region = screen.getByRole("region", { name: "Plan preview: Migration" }).element();
    const header = region.querySelector("header")!;
    const identity = header.querySelector("svg")!;
    const download = screen.getByRole("button", { name: "Download plan" }).element();
    const copy = screen.getByRole("button", { name: "Copy plan" }).element();
    const expand = screen.getByRole("button", { name: "Expand plan" }).element();
    expect(region.getBoundingClientRect().height).toBe(292);
    expect(header.getBoundingClientRect().height).toBe(44);
    expect(identity.getBoundingClientRect().left - header.getBoundingClientRect().left).toBe(16);
    expect(identity.getBoundingClientRect().width).toBe(12);
    expect(
      screen.getByText("Plan", { exact: true }).element().getBoundingClientRect().left -
        identity.getBoundingClientRect().right,
    ).toBe(8);
    expect(header.getBoundingClientRect().right - expand.getBoundingClientRect().right).toBe(12);
    expect(copy.getBoundingClientRect().left - download.getBoundingClientRect().right).toBe(4);
    expect(expand.getBoundingClientRect().left - copy.getBoundingClientRect().right).toBe(4);
    for (const action of [download, copy, expand]) {
      expect(action.getBoundingClientRect().width).toBe(24);
      expect(action.getBoundingClientRect().height).toBe(24);
      expect(getComputedStyle(action).borderRadius).toBe("6px");
      expect(action.querySelector("svg")!.getBoundingClientRect().width).toBe(12);
      expect(getComputedStyle(action).cursor).toBe("pointer");
      expect(getComputedStyle(action.querySelector("svg")!).cursor).toBe("pointer");
    }
  } finally {
    await screen.unmount();
  }
});
