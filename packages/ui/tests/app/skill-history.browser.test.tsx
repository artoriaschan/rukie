import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import "../../src/theme.css";

test("history uses persisted invocation after deletion and copies selected tokens with the current path", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  const update = async (path: string | undefined) =>
    fetch(`http://127.0.0.1:${connection.port}/skills`, {
      method: "POST",
      body: JSON.stringify({
        "session:one": path
          ? [{ name: "review", description: "Review", scope: "project", filePath: path }]
          : [],
      }),
    });
  await update("/current/review/SKILL.md");
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App host={{ getConnection: async () => connection, modelServices: modelServicesFixture }} />,
  );
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
        {
          role: "user",
          entryId: "u",
          timestamp: 1,
          content: "/review inspect changes",
          skillInvocation:
            'The user invoked this skill directly; its full instructions are already included.\n\n<skill name="review" location="/old/review/SKILL.md">Instructions</skill>',
        },
        { role: "user", entryId: "plain", timestamp: 2, content: "/review ordinary text" },
      ],
      queuedInputs: [],
      toolStates: {},
      background: [],
      runSummaries: [],
    }),
  });
  const feed = screen.getByRole("feed");
  await expect.element(feed.getByText("/review ordinary text", { exact: true })).toBeVisible();
  await expect
    .poll(() => feed.element().querySelector("[data-skill-token]")?.textContent)
    .toBe("review");
  const copy = () => {
    const text = feed.element().querySelector("[data-user-prompt]")!;
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const data = new DataTransfer();
    text.dispatchEvent(
      new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }),
    );
    return data;
  };
  await expect
    .poll(() => copy().getData("text/plain"))
    .toBe("[$review](/current/review/SKILL.md) inspect changes");
  expect(copy().getData("text/html")).not.toContain("<a");
  const token = feed.element().querySelector<HTMLElement>("[data-skill-token]")!;
  const range = document.createRange();
  range.selectNodeContents(token);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const data = new DataTransfer();
  token!.dispatchEvent(
    new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }),
  );
  expect(data.getData("text/plain")).toBe("[$review](/current/review/SKILL.md)");
  await update(undefined);
  const input = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await input.fill("/");
  await expect.poll(() => copy().getData("text/plain")).toBe("/review inspect changes");
  expect(feed.element().querySelector("[data-skill-token]")?.textContent).toBe("review");
  expect(feed.element().querySelectorAll("[data-skill-token]").length).toBe(1);
});
