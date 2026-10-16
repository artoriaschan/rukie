import { expect, test } from "vitest";
import { PromptInput } from "../../src/components/agents/prompt-input";
import { commands } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ToolApproval } from "../../src/components/agents/tool-approval";
import { ApprovalCard } from "../../src/components/agents/approval-card";
import { Button } from "../../src/components/motion/button";
import { Input } from "../../src/components/motion/input";
import { UiLocaleProvider } from "../../src/lib/i18n";
import "../../src/theme.css";

for (const theme of ["light", "dark"] as const) {
  test(`${theme} waiting confirmation differs from completed success and requested changes`, async () => {
    const screen = await render(
      <UiLocaleProvider locale="en">
        <div className={theme}>
          <ToolApproval tool="bash" status="pending" />
          <ToolApproval tool="read" status="approved" />
          <ApprovalCard title="Question" status="pending" />
          <ApprovalCard title="Review" status="changes-requested" />
          <Input label="Setting" placeholder="Enter a value" />
        </div>
      </UiLocaleProvider>,
    );
    try {
      const waiting = screen.getByText("Approval required").element();
      const question = screen.getByText("Input required").element();
      const approved = screen.getByText("Approved", { exact: true }).element();
      const changes = screen.getByText("Changes requested", { exact: true }).elements()[0];
      if (!changes) throw new Error("Missing requested-changes status");
      expect(getComputedStyle(waiting).color).toBe(
        theme === "light" ? "rgb(17, 99, 41)" : "rgb(126, 231, 135)",
      );
      expect(getComputedStyle(question).color).toBe(getComputedStyle(waiting).color);
      expect(getComputedStyle(waiting).backgroundColor).toBe(
        theme === "light" ? "rgb(218, 251, 225)" : "rgb(3, 58, 22)",
      );
      expect(getComputedStyle(approved).color).not.toBe(getComputedStyle(waiting).color);
      expect(getComputedStyle(changes).color).toBe(
        theme === "light" ? "rgb(166, 91, 0)" : "rgb(255, 138, 48)",
      );
      const input = screen.getByRole("textbox", { name: "Setting" });
      await input.click();
      expect(input.element().parentElement?.classList.contains("bg-input-focused")).toBe(true);
      expect(getComputedStyle(input.element(), "::placeholder").color).toBe(
        theme === "light" ? "rgb(107, 107, 107)" : "rgb(168, 168, 168)",
      );
    } finally {
      await screen.unmount();
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} field hover preserves focus, error and disabled borders`, async () => {
    const screen = await render(
      <div className={theme}>
        <Input label="Idle field" />
        <Input label="Invalid field" error="Invalid value" />
        <Input label="Disabled field" disabled />
        <Button variant="ghost">Ghost action</Button>
        <Button variant="outline">Outline action</Button>
      </div>,
    );
    try {
      const idle = screen.getByRole("textbox", { name: "Idle field" });
      const invalid = screen.getByRole("textbox", { name: "Invalid field" });
      const disabled = screen.getByRole("textbox", { name: "Disabled field" });
      const idleField = idle.element().parentElement;
      const invalidField = invalid.element().parentElement;
      const disabledField = disabled.element().parentElement;
      if (!idleField || !invalidField || !disabledField) throw new Error("Missing input field");
      // Distinct role values make precedence observable even when a palette aliases them.
      for (const field of [idleField, invalidField, disabledField]) {
        field.style.setProperty("--input-border", "rgb(80, 90, 100)");
        field.style.setProperty("--input-border-hover", "rgb(100, 110, 120)");
        field.style.setProperty("--input-border-focused", "rgb(20, 80, 140)");
        field.style.setProperty("--destructive", "rgb(180, 30, 40)");
      }
      await expect.poll(() => getComputedStyle(idleField).borderTopColor).toBe("rgb(80, 90, 100)");
      await idle.hover();
      await expect
        .poll(() => getComputedStyle(idleField).borderTopColor)
        .toBe("rgb(100, 110, 120)");
      await idle.click();
      await expect.poll(() => getComputedStyle(idleField).borderTopColor).toBe("rgb(20, 80, 140)");
      await screen.getByRole("button", { name: "Ghost action" }).hover();
      await idle.hover();
      expect(getComputedStyle(idleField).borderTopColor).toBe("rgb(20, 80, 140)");
      await invalid.hover();
      await expect
        .poll(() => getComputedStyle(invalidField).borderTopColor)
        .toBe("rgb(180, 30, 40)");
      await invalid.click();
      expect(getComputedStyle(invalidField).borderTopColor).toBe("rgb(180, 30, 40)");
      await disabled.hover();
      await expect
        .poll(() => getComputedStyle(disabledField).borderTopColor)
        .toBe("rgb(80, 90, 100)");
      for (const name of ["Ghost action", "Outline action"]) {
        const action = screen.getByRole("button", { name });
        action.element().style.setProperty("--hover", "rgb(220, 225, 230)");
        await action.hover();
        await expect
          .poll(() => getComputedStyle(action.element()).backgroundColor)
          .toBe("rgb(220, 225, 230)");
      }
    } finally {
      await screen.unmount();
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} semantic surfaces use the shared neutral palette and accessible roles`, async () => {
    const surfaces = [
      "background",
      "card",
      "muted",
      "secondary",
      "surface",
      "popover",
      "selected",
    ] as const;
    const roles = [
      "foreground",
      "muted-foreground",
      "foreground-subtlest",
      "accent",
      "danger",
      "success",
      "warning",
      "input-border",
      "ring",
    ] as const;
    const screen = await render(
      <div className={theme}>
        {surfaces.map((surface) => (
          <section key={surface} aria-label={surface} style={{ background: `var(--${surface})` }}>
            {roles.map((role) => (
              <span key={role} style={{ color: `var(--${role})` }}>
                {role}
              </span>
            ))}
          </section>
        ))}
        <p className="text-ui-caption">Caption role</p>
      </div>,
    );
    try {
      const expected =
        theme === "light"
          ? [
              "rgb(255, 255, 255)",
              "rgb(255, 255, 255)",
              "rgb(245, 245, 245)",
              "rgb(255, 255, 255)",
              "rgb(245, 245, 245)",
              "rgb(255, 255, 255)",
              "rgb(241, 241, 241)",
            ]
          : [
              "rgb(33, 33, 33)",
              "rgb(33, 33, 33)",
              "rgb(47, 47, 47)",
              "rgb(40, 40, 40)",
              "rgb(40, 40, 40)",
              "rgb(47, 47, 47)",
              "rgb(58, 58, 58)",
            ];
      for (const [index, surface] of surfaces.entries()) {
        const element = screen.getByRole("region", { name: surface }).element();
        const background = getComputedStyle(element).backgroundColor;
        expect(background).toBe(expected[index]);
        for (const text of element.querySelectorAll("span")) {
          const threshold = ["input-border", "ring"].includes(text.textContent ?? "") ? 3 : 4.5;
          expect(
            contrast(getComputedStyle(text).color, background),
            `${theme} ${text.textContent} on ${surface}`,
          ).toBeGreaterThanOrEqual(threshold);
        }
      }
      expect(getComputedStyle(screen.getByText("Caption role").element()).lineHeight).toBe("18px");
    } finally {
      await screen.unmount();
    }
  });
}

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Unexpected color: ${color}`);
    return channels.reduce((value, channel, index) => {
      const normalized = channel / 255;
      const linear =
        normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      return value + linear * [0.2126, 0.7152, 0.0722][index]!;
    }, 0);
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("System Dark and explicit Dark render the same semantic and structural surfaces before theme scripts", async () => {
  const root = document.documentElement;
  const previous = root.className;
  const screen = await render(
    <>
      <section
        aria-label="Canvas"
        style={{ background: "var(--background)", color: "var(--foreground)" }}
      >
        Canvas
      </section>
      <aside aria-label="Structural canvas" style={{ background: "var(--layout-content)" }}>
        Transcript
      </aside>
    </>,
  );
  try {
    await commands.colorScheme("dark");
    root.classList.remove("dark", "light");
    const canvas = screen.getByRole("region", { name: "Canvas" }).element();
    const structural = screen.getByRole("complementary", { name: "Structural canvas" }).element();
    const system = [
      getComputedStyle(canvas).backgroundColor,
      getComputedStyle(canvas).color,
      getComputedStyle(structural).backgroundColor,
    ];
    expect(system).toEqual(["rgb(33, 33, 33)", "rgb(250, 250, 250)", "rgb(0, 0, 0)"]);
    root.classList.add("dark");
    expect([
      getComputedStyle(canvas).backgroundColor,
      getComputedStyle(canvas).color,
      getComputedStyle(structural).backgroundColor,
    ]).toEqual(system);
    await commands.colorScheme("light");
    expect(getComputedStyle(canvas).backgroundColor).toBe(system[0]);
    root.className = "light";
    await commands.colorScheme("dark");
    expect(getComputedStyle(canvas).backgroundColor).toBe("rgb(255, 255, 255)");
  } finally {
    root.className = previous;
    await commands.colorScheme("light");
    await screen.unmount();
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} composer and Select overlay consume shared elevation without a focus shadow reset`, async () => {
    const root = document.documentElement;
    const previous = root.className;
    root.className = theme;
    const screen = await render(<PromptInput models={[{ value: "one", label: "One model" }]} />);
    try {
      const composer = screen.getByRole("textbox").element().closest("form")!;
      const expectedComposer =
        theme === "light"
          ? "rgba(0, 0, 0, 0.08) 0px 3px 16px 0px"
          : "rgba(0, 0, 0, 0.32) 0px 3px 16px 0px";
      expect(getComputedStyle(composer).boxShadow).toContain(expectedComposer);
      await screen.getByRole("button", { name: "One model", exact: true }).click();
      const overlay = screen.getByRole("listbox").element();
      const expectedNear =
        theme === "light"
          ? "rgba(0, 0, 0, 0.03) 0px 1px 2px 0px"
          : "rgba(0, 0, 0, 0.2) 0px 1px 2px 0px";
      expect(getComputedStyle(overlay).boxShadow).toContain(expectedNear);
      expect(getComputedStyle(overlay).boxShadow).toContain("0px 10px 24px -8px");
      const option = screen.getByRole("option", { name: "One model", exact: true });
      option.element().focus();
      expect(getComputedStyle(overlay).boxShadow).toContain(expectedNear);
    } finally {
      await screen.unmount();
      root.className = previous;
    }
  });
}
