import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ToolRow } from "../../src/components/tool-row";
import { QuestionDock } from "../../src/components/question-dock";
import { UiLocaleProvider } from "../../src/lib/i18n";
import type { WireQuestionRequest } from "@rukie/shared";
import "../../src/theme.css";
const request: WireQuestionRequest = {
  kind: "question",
  identity: { epoch: "multi", requestId: "multi", conversationId: 1, taskId: 1 },
  toolCallId: "multi-call",
  origin: { agentId: "child", description: "Storage researcher" },
  questions: [
    {
      header: "Storage",
      question: "Which storage?",
      options: [
        { label: "SQLite", description: "Local database" },
        { label: "Memory", description: "Temporary data" },
      ],
    },
    {
      header: "Features",
      question: "Which features?",
      multiSelect: true,
      options: [
        { label: "Search", description: "Find text" },
        { label: "Export", description: "Save results" },
      ],
    },
  ],
};
test("multiple questions preserve previous answers, collect multiple choices and custom text", async () => {
  const onReply = vi.fn();
  const screen = await render(
    <UiLocaleProvider locale="en">
      <QuestionDock request={request} connected pending={null} shortcutsEnabled onReply={onReply} />
    </UiLocaleProvider>,
  );
  try {
    await expect.element(screen.getByText("Storage researcher")).toBeVisible();
    await expect.element(screen.getByText("1 / 2", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: /SQLite/ }).click();
    await expect.element(screen.getByText("2 / 2", { exact: true })).toBeVisible();
    expect(onReply).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Previous question" }).click();
    await expect
      .element(screen.getByRole("button", { name: /SQLite/ }))
      .toHaveAttribute("aria-pressed", "true");
    await screen.getByRole("button", { name: "Next question" }).click();
    await screen.getByRole("checkbox", { name: "Search" }).click();
    await userEvent.keyboard("2");
    await expect.element(screen.getByRole("checkbox", { name: "Export" })).toBeChecked();
    await screen.getByRole("textbox", { name: "Write another answer…" }).fill("Offline too");
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Submit", exact: true }).element())
        .backgroundColor,
    ).toBe("rgb(0, 0, 0)");
    await screen.getByRole("button", { name: "Submit", exact: true }).click();
    expect(onReply).toHaveBeenCalledWith(request, {
      answers: [
        { selected: ["SQLite"] },
        { selected: ["Search", "Export"], custom: "Offline too" },
      ],
    });
  } finally {
    await screen.unmount();
  }
});

test("arrow selection submits and shortcuts exclude IME, editable targets and disabled cards", async () => {
  const onReply = vi.fn();
  const single = { ...request, questions: [request.questions[0]!] };
  const screen = await render(
    <UiLocaleProvider locale="en">
      <QuestionDock request={single} connected pending={null} shortcutsEnabled onReply={onReply} />
    </UiLocaleProvider>,
  );
  try {
    const region = screen.getByRole("region", { name: "Question required" });
    region.element().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await userEvent.keyboard("2{Enter}{Escape}");
    expect(onReply).not.toHaveBeenCalled();
    region.element().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    const custom = screen.getByRole("textbox");
    await custom.fill("Custom 123");
    await userEvent.keyboard("12{ArrowDown}");
    expect(onReply).not.toHaveBeenCalled();
    await custom.clear();
    region.element().focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onReply).toHaveBeenCalledWith(single, {
      answers: [{ selected: ["Memory"], custom: "" }],
    });
    onReply.mockClear();
    await screen.rerender(
      <UiLocaleProvider locale="en">
        <QuestionDock
          request={single}
          connected={false}
          pending={null}
          shortcutsEnabled
          onReply={onReply}
        />
      </UiLocaleProvider>,
    );
    await expect.element(screen.getByRole("button", { name: /SQLite/ })).toBeDisabled();
    await userEvent.keyboard("1{Enter}{Escape}");
    expect(onReply).not.toHaveBeenCalled();
  } finally {
    await screen.unmount();
  }
});

test("C43 uses 752px input surface, 16px corners, 48px rows and readable narrow Light/Dark content", async () => {
  await page.viewport(1280, 900);
  const screen = await render(
    <UiLocaleProvider locale="en">
      <div className="mx-auto w-full max-w-[800px] px-6">
        <QuestionDock
          request={{ ...request, questions: [request.questions[0]!] }}
          connected
          pending={null}
          shortcutsEnabled
          onReply={() => {}}
        />
      </div>
    </UiLocaleProvider>,
  );
  try {
    const region = screen.getByRole("region").element();
    const row = screen.getByRole("button", { name: /SQLite/ }).element();
    expect(region.getBoundingClientRect().width).toBeCloseTo(752, 0);
    expect(getComputedStyle(region).borderRadius).toBe("16px");
    expect(row.getBoundingClientRect().height).toBeCloseTo(48, 0);
    expect(getComputedStyle(row).cursor).toBe("pointer");
    await userEvent.keyboard("{Tab}{Tab}");
    await expect.element(screen.getByRole("button", { name: /SQLite/ })).toHaveFocus();
    expect(row.matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(row).boxShadow).not.toBe("none");
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle("dark", dark);
      expect(getComputedStyle(region).backgroundColor).toBe(
        dark ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)",
      );
      await page.viewport(420, 700);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
      expect(region.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth);
      expect(row.getBoundingClientRect().height).toBeCloseTo(48, 0);
    }
  } finally {
    document.documentElement.classList.remove("dark");
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test.each(["Skip", "Skip interaction", "Escape"])(
  "%s declines the complete question interaction",
  async (action) => {
    const onReply = vi.fn();
    const screen = await render(
      <UiLocaleProvider locale="en">
        <QuestionDock
          request={request}
          connected
          pending={null}
          shortcutsEnabled
          onReply={onReply}
        />
      </UiLocaleProvider>,
    );
    try {
      if (action === "Escape") await userEvent.keyboard("{Escape}");
      else await screen.getByRole("button", { name: action, exact: true }).click();
      expect(onReply).toHaveBeenCalledWith(request, "declined");
    } finally {
      await screen.unmount();
    }
  },
);

test("custom-only Chinese answer submits with Enter while modal focus excludes card shortcuts", async () => {
  const onReply = vi.fn();
  const single = { ...request, questions: [request.questions[0]!] };
  const screen = await render(
    <UiLocaleProvider locale="zh">
      <div role="dialog" aria-modal="true" aria-label="Other dialog">
        <button type="button">Other action</button>
      </div>
      <QuestionDock request={single} connected pending={null} shortcutsEnabled onReply={onReply} />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Other action" }).element().focus();
    await screen.getByRole("region").element().focus();
    await userEvent.keyboard("2{Enter}{Escape}");
    expect(onReply).not.toHaveBeenCalled();
    await screen.rerender(
      <UiLocaleProvider locale="zh">
        <QuestionDock
          request={single}
          connected
          pending={null}
          shortcutsEnabled
          onReply={onReply}
        />
      </UiLocaleProvider>,
    );
    const custom = screen.getByRole("textbox", { name: "输入其他回答…" });
    await custom.fill("使用本地文件");
    await expect.element(screen.getByRole("button", { name: "提交", exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    expect(onReply).toHaveBeenCalledWith(single, {
      answers: [{ selected: [], custom: "使用本地文件" }],
    });
  } finally {
    await screen.unmount();
  }
});

test("ask_user_question tool rows use localized question copy", async () => {
  const screen = await render(
    <UiLocaleProvider locale="zh">
      <ToolRow
        tool={{
          id: "ask-call",
          name: "ask_user_question",
          args: {},
          status: "success",
          output: "Answered",
        }}
      />
    </UiLocaleProvider>,
  );
  try {
    await expect.element(screen.getByText("提问", { exact: true })).toBeVisible();
  } finally {
    await screen.unmount();
  }
});

test("Escape from the custom input declines after IME composition finishes", async () => {
  const onReply = vi.fn();
  const screen = await render(
    <UiLocaleProvider locale="en">
      <QuestionDock request={request} connected pending={null} shortcutsEnabled onReply={onReply} />
    </UiLocaleProvider>,
  );
  try {
    const custom = screen.getByRole("textbox");
    await custom.fill("Unsubmitted answer");
    custom.element().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await userEvent.keyboard("{Escape}");
    expect(onReply).not.toHaveBeenCalled();
    custom.element().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await userEvent.keyboard("{Escape}");
    expect(onReply).toHaveBeenCalledWith(request, "declined");
  } finally {
    await screen.unmount();
  }
});

test("initial ArrowUp selects the final answer before Enter submits", async () => {
  const onReply = vi.fn();
  const single = { ...request, questions: [request.questions[0]!] };
  const screen = await render(
    <UiLocaleProvider locale="en">
      <QuestionDock request={single} connected pending={null} shortcutsEnabled onReply={onReply} />
    </UiLocaleProvider>,
  );
  try {
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(onReply).toHaveBeenCalledWith(single, { answers: [{ selected: ["Memory"] }] });
  } finally {
    await screen.unmount();
  }
});
