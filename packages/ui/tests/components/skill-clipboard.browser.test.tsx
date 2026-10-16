import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PromptInput } from "../../src/components/agents/prompt-input";
import "../../src/theme.css";
const skills = [
  {
    name: "review",
    description: "Review",
    scope: "project" as const,
    filePath: "/project/review/SKILL.md",
  },
];
const link = "[$review](/project/review/SKILL.md)";
const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
function clipboard(input: Element, type: "copy" | "cut" | "paste", data = new DataTransfer()) {
  input.dispatchEvent(
    new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }),
  );
  return data;
}
test("copy and cut export selected skill content in three formats and leave unselected text", async () => {
  const screen = await render(
    <div style={{ marginTop: 400 }}>
      <PromptInput skills={skills} />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/r");
    await userEvent.keyboard("{Tab}body");
    await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`);
    const data = clipboard(input.element(), "copy");
    expect(data.getData("text/plain")).toBe(`${link} body`);
    expect(data.getData("text/html")).toContain(link);
    expect(data.getData("text/html")).not.toContain("<a");
    expect(data.getData("application/x-lexical-editor")).toContain('"type":"skill-token"');
    await userEvent.keyboard("{ArrowRight}{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}");
    const cut = clipboard(input.element(), "cut");
    expect(cut.getData("text/plain")).toBe("dy");
    await expect.element(input).toHaveTextContent("review bo");
    await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`);
    const tokenCut = clipboard(input.element(), "cut");
    expect(tokenCut.getData("text/plain")).toBe(`${link} bo`);
    expect(tokenCut.getData("text/html")).toBe(`<pre>${link} bo</pre>`);
    await expect.poll(() => input.element().textContent).toBe("");
    await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
    await expect.element(input).toHaveTextContent("review bo");
  } finally {
    await screen.unmount();
  }
});

test("pasted skill links and internal nodes restore only at the beginning, replace tokens and undo separately", async () => {
  const sent = vi.fn();
  const screen = await render(
    <div style={{ marginTop: 400 }}>
      <PromptInput
        skills={[...skills, { ...skills[0]!, name: "build", filePath: "/build/SKILL.md" }]}
        onSubmit={sent}
      />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox");
    await input.click();
    const data = new DataTransfer();
    data.setData("text/plain", `${link} inspect`);
    clipboard(input.element(), "paste", data);
    await expect
      .poll(() => input.element().querySelector("[data-skill-token]")?.textContent)
      .toBe("review");
    await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`);
    const internal = clipboard(input.element(), "copy");
    internal.clearData("text/plain");
    internal.clearData("text/html");
    await userEvent.keyboard("{ArrowRight}");
    clipboard(input.element(), "paste", internal);
    await expect.element(input).toHaveTextContent(`review inspect${link} inspect`);
    expect(input.element().querySelectorAll("[data-skill-token]").length).toBe(1);
    await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
    await expect.element(input).toHaveTextContent("review inspect");
    await userEvent.keyboard("{Home}{ArrowLeft}");
    const replacement = new DataTransfer();
    replacement.setData("text/plain", "[$build](/build/SKILL.md)");
    clipboard(input.element(), "paste", replacement);
    await expect
      .poll(() => input.element().querySelector("[data-skill-token]")?.textContent)
      .toBe("build");
    await userEvent.keyboard("{Enter}");
    expect(sent).toHaveBeenCalledWith("/build inspect", undefined);
    await input.click();
    clipboard(input.element(), "paste", internal);
    await expect
      .poll(() => input.element().querySelector("[data-skill-token]")?.textContent)
      .toBe("review");
    await userEvent.keyboard("{Enter}");
    expect(sent).toHaveBeenCalledWith("/review inspect", undefined);
    await input.click();
    const unknown = new DataTransfer();
    unknown.setData("text/plain", "[$missing](/missing/SKILL.md)");
    clipboard(input.element(), "paste", unknown);
    await expect.element(input).toHaveTextContent("[$missing](/missing/SKILL.md)");
    expect(input.element().querySelector("[data-skill-token]")).toBeNull();
  } finally {
    await screen.unmount();
  }
});

test("plain Markdown pasted into a body stays literal and undo preserves preceding typing", async () => {
  const screen = await render(<PromptInput skills={skills} />);
  try {
    const input = screen.getByRole("combobox");
    await input.click();
    await userEvent.keyboard("prefix ");
    const data = new DataTransfer();
    data.setData("text/plain", link);
    clipboard(input.element(), "paste", data);
    await expect.element(input).toHaveTextContent(`prefix ${link}`);
    expect(input.element().querySelector("[data-skill-token]")).toBeNull();
    await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
    await expect.poll(() => input.element().textContent).toBe("prefix ");
  } finally {
    await screen.unmount();
  }
});
