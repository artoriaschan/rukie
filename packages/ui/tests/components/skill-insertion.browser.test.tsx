import { useState, type ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PromptInput } from "../../src/components/agents/prompt-input";
import "../../src/theme.css";

async function renderPrompt(children: ReactNode) {
  return render(<div style={{ marginTop: 400 }}>{children}</div>);
}

const skills = [
  {
    name: "review",
    description: "Review changes",
    scope: "project" as const,
    filePath: "/project/.agents/skills/review/SKILL.md",
  },
];

test("slash skill selection preserves editor focus and serializes the token", async () => {
  const sent = vi.fn();
  const screen = await renderPrompt(<PromptInput skills={skills} onSubmit={sent} />);
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/RE");
    await expect
      .element(screen.getByRole("option", { name: "review Review changes Project" }))
      .toBeVisible();
    await userEvent.keyboard("{Tab}");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveTextContent("review");
    await userEvent.keyboard("inspect changes{Enter}");
    expect(sent).toHaveBeenCalledWith("/review inspect changes", undefined);
  } finally {
    await screen.unmount();
  }
});

test("skill picker closes for whitespace, selection outside first line, unknown names and Escape", async () => {
  const sent = vi.fn();
  const screen = await renderPrompt(<PromptInput skills={skills} onSubmit={sent} />);
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/review body");
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await input.fill("body /review");
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await input.fill("/unknown");
    await userEvent.keyboard("{Enter}");
    expect(sent).toHaveBeenCalledWith("/unknown", undefined);
    await input.fill("/review");
    await expect.element(input).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await expect.element(input).toHaveFocus();
  } finally {
    await screen.unmount();
  }
});

test("skill token alone sends and Backspace removes the complete token", async () => {
  const sent = vi.fn();
  const screen = await renderPrompt(<PromptInput skills={skills} onSubmit={sent} />);
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/r");
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveTextContent("review");
    await userEvent.keyboard("{Enter}");
    expect(sent).toHaveBeenCalledWith("/review", undefined);
    await input.fill("/r");
    await userEvent.keyboard("{Enter}{Backspace}{Backspace}");
    await expect.poll(() => input.element().textContent).toBe("");
    expect(input.element().querySelector("[data-skill-token]")).toBeNull();
  } finally {
    await screen.unmount();
  }
});

test("list filters names with prefix priority and keeps ten rows above the composer", async () => {
  const catalog = [
    "z-review",
    "review",
    ...Array.from({ length: 12 }, (_, index) => `skill-${String(index).padStart(2, "0")}`),
  ].map((name) => ({ ...skills[0]!, name }));
  const screen = await renderPrompt(
    <div style={{ width: 360 }}>
      <PromptInput skills={catalog} />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/REVIEW");
    const options = screen.getByRole("option");
    await expect.poll(() => options.all().length).toBe(2);
    expect(options.all()[0]!.element().getAttribute("aria-label")).toBe(
      "review Review changes Project",
    );
    await input.fill("/");
    await expect.poll(() => options.all().length).toBe(14);
    const panel = screen.getByRole("dialog", { name: "Insert" }).element();
    const form = input.element().closest("form")!;
    expect(panel.getBoundingClientRect().width).toBe(form.getBoundingClientRect().width);
    await expect
      .poll(() => panel.getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(form.getBoundingClientRect().top);
    const viewport = panel.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")!;
    expect(viewport.clientHeight).toBe(344);
    const row = options.all()[0]!.element();
    expect(getComputedStyle(row.querySelector(".composer-insertion-description")!).display).toBe(
      "none",
    );
    const scope = row.querySelector(".composer-insertion-scope")!;
    expect(scope.clientWidth).toBe(scope.scrollWidth);
    await userEvent.keyboard("{ArrowUp}");
    await expect.poll(() => viewport.scrollTop).toBeGreaterThan(0);
    expect(input.element().getAttribute("aria-activedescendant")).toBe(
      options.all()[13]!.element().id,
    );
    await userEvent.keyboard("{Tab}");
    expect(input.element().querySelector("[data-skill-token]")?.textContent).toBe("z-review");
  } finally {
    await screen.unmount();
  }
});

test("controlled draft rerenders keep the atomic token while text edits and replacement serialize", async () => {
  const sent = vi.fn();
  function Controlled() {
    const [value, setValue] = useState("");
    const [count, setCount] = useState(0);
    return (
      <>
        <button onClick={() => setCount(count + 1)}>Rerender {count}</button>
        <PromptInput
          skills={[...skills, { ...skills[0]!, name: "build" }]}
          value={value}
          onValueChange={setValue}
          onSubmit={sent}
        />
      </>
    );
  }
  const screen = await renderPrompt(<Controlled />);
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/r");
    await userEvent.keyboard("{Tab}body");
    await screen.getByRole("button", { name: "Rerender 0" }).click();
    expect(input.element().querySelector("[data-skill-token]")?.textContent).toBe("review");
    await input.click();
    await userEvent.keyboard("{End}{Backspace}{Enter}");
    expect(sent).toHaveBeenCalledWith("/review bod", undefined);
    await input.fill("/b");
    await userEvent.keyboard("{Tab}");
    expect(input.element().querySelectorAll("[data-skill-token]").length).toBe(1);
    expect(input.element().querySelector("[data-skill-token]")?.textContent).toBe("build");
  } finally {
    await screen.unmount();
  }
});

test("skill insertion participates in undo and disabled editors cannot open options", async () => {
  function Controlled() {
    const [disabled, setDisabled] = useState(false);
    return (
      <>
        <PromptInput skills={skills} disabled={disabled} />
        <button onClick={() => setDisabled(true)}>Disable</button>
      </>
    );
  }
  const screen = await renderPrompt(<Controlled />);
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/review");
    await userEvent.keyboard("{Tab}");
    expect(input.element().querySelector("[data-skill-token]")).not.toBeNull();
    await userEvent.keyboard(
      navigator.platform.includes("Mac") ? "{Meta>}z{/Meta}" : "{Control>}z{/Control}",
    );
    await expect.poll(() => input.element().querySelector("[data-skill-token]")).toBeNull();
    await input.fill("/review");
    await expect.element(input).toHaveAttribute("aria-expanded", "true");
    await screen.getByRole("button", { name: "Disable", exact: true }).click();
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await expect.element(input).toHaveAttribute("contenteditable", "false");
  } finally {
    await screen.unmount();
  }
});

test("skill catalog preserves the existing composer height before and after opening", async () => {
  const screen = await renderPrompt(
    <>
      <PromptInput aria-label="Baseline" />
      <PromptInput skills={skills} aria-label="With skills" />
    </>,
  );
  try {
    const baseline = screen.getByRole("textbox", { name: "Baseline" }).element().closest("form")!;
    const input = screen.getByRole("combobox", { name: "With skills" });
    const form = input.element().closest("form")!;
    expect(form.getBoundingClientRect().height).toBe(baseline.getBoundingClientRect().height);
    const before = form.getBoundingClientRect().toJSON();
    await input.fill("/");
    await expect.element(input).toHaveAttribute("aria-expanded", "true");
    expect(form.getBoundingClientRect().toJSON()).toEqual(before);
  } finally {
    await screen.unmount();
  }
});
