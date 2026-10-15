import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { GoalStatus } from "../../src/components/goal-status";
import { UiLocaleProvider } from "../../src/lib/i18n";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import type { GoalView } from "@rukie/agent";
import "../../src/theme.css";
const goal: GoalView = {
  id: "one",
  objective: "First target",
  attachments: 0,
  phase: "active",
  armed: true,
  roundsStarted: 1,
  maxRounds: 10,
  elapsedMs: 2000,
  activeSince: 1000,
};

test("Goal elapsed time ticks at one second and freezes when paused", async () => {
  const owner = ownProjectBrowserTest();
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(1000);
  const screen = await owner.render(
    <GoalStatus goal={goal} disabled={false} onAction={async () => {}} />,
  );
  await expect.element(screen.getByText("2s", { exact: true })).toBeVisible();
  await vi.advanceTimersByTimeAsync(999);
  expect(screen.getByText("3s", { exact: true }).query()).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  await expect.element(screen.getByText("3s", { exact: true })).toBeVisible();
  await screen.rerender(
    <GoalStatus
      goal={{ ...goal, phase: "paused", armed: false, activeSince: undefined, elapsedMs: 3000 }}
      disabled={false}
      onAction={async () => {}}
    />,
  );
  await vi.advanceTimersByTimeAsync(60000);
  await expect.element(screen.getByText("3s", { exact: true })).toBeVisible();
  await screen.rerender(
    <GoalStatus
      goal={{ ...goal, elapsedMs: 3000, activeSince: 62000 }}
      disabled={false}
      onAction={async () => {}}
    />,
  );
  await vi.advanceTimersByTimeAsync(1000);
  await expect.element(screen.getByText("4s", { exact: true })).toBeVisible();
});

test.each([
  { locale: "en", width: 1280, dark: false },
  { locale: "zh", width: 420, dark: true },
] as const)(
  "Goal states preserve C38 geometry, names and disabled controls ($locale)",
  async ({ locale, width, dark }) => {
    const owner = ownProjectBrowserTest();
    await page.viewport(width, 900);
    document.documentElement.classList.toggle("dark", dark);
    const action = vi.fn(async () => {});
    const ui = (value: GoalView) => (
      <UiLocaleProvider locale={locale}>
        <div style={{ width: "calc(100vw - 100px)", marginLeft: 50 }}>
          <GoalStatus goal={value} disabled={false} onAction={action} />
          <div
            className="conversation-composer"
            style={{ height: 100, borderRadius: 16, position: "relative" }}
          />
        </div>
      </UiLocaleProvider>
    );
    const screen = await owner.render(ui({ ...goal, armed: false, activeSince: undefined }));
    const paused = locale === "en" ? "Paused" : "已暂停";
    await expect.element(screen.getByText(paused, { exact: true })).toBeVisible();
    const bar = document.querySelector<HTMLElement>(".goal-status-bar")!;
    const box = bar.getBoundingClientRect();
    const composer = document.querySelector<HTMLElement>(".conversation-composer")!;
    expect(box.height).toBe(40);
    expect(box.width).toBe(composer.getBoundingClientRect().width);
    expect(box.bottom).toBe(composer.getBoundingClientRect().top);
    expect(getComputedStyle(bar).borderTopLeftRadius).toBe("12px");
    expect(getComputedStyle(bar).borderBottomLeftRadius).toBe("0px");
    expect(getComputedStyle(bar, "::after").height).toBe("16px");
    await screen.rerender(
      ui({
        ...goal,
        phase: "blocked",
        armed: false,
        activeSince: undefined,
        blockedReason: "Need access to repository",
        objective: "",
        attachments: 2,
      }),
    );
    const blocked = screen.getByRole("img", {
      name:
        locale === "en"
          ? "Blocked: Need access to repository"
          : "已受阻: Need access to repository",
      exact: true,
    });
    await expect.element(blocked).toBeVisible();
    await blocked.hover();
    await expect
      .element(screen.getByRole("tooltip"))
      .toHaveTextContent("Need access to repository");
    await expect
      .element(
        screen.getByText(locale === "en" ? "Image goal · 2 images" : "图片目标 · 2 张图片", {
          exact: true,
        }),
      )
      .toBeVisible();
    await screen.rerender(
      ui({
        ...goal,
        phase: "blocked",
        armed: false,
        activeSince: undefined,
        blockedReason: "Limit wins",
        roundsStarted: 10,
      }),
    );
    await expect
      .element(
        screen.getByText(locale === "en" ? "Round limit reached" : "已达上限", { exact: true }),
      )
      .toBeVisible();
    const resume = screen.getByRole("button", {
      name: locale === "en" ? "Resume goal" : "继续目标",
      exact: true,
    });
    await expect.element(resume).toBeDisabled();
    expect(getComputedStyle(resume.element()).cursor).toBe("not-allowed");
    expect(getComputedStyle(resume.element()).opacity).toBe("0.4");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    await screen.rerender(ui({ ...goal, phase: "complete", armed: false, activeSince: undefined }));
    expect(document.querySelector(".goal-status-bar")).toBeNull();
  },
);

test("Goal objective remains readable and controls wait for their command response", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(420, 900);
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const action = vi.fn(() => pending);
  const objective =
    "The complete first target stays available through keyboard focus and a tooltip when the single line is too long";
  const screen = await owner.render(
    <div style={{ width: 320 }}>
      <GoalStatus
        goal={{ ...goal, objective, armed: false, activeSince: undefined }}
        disabled={false}
        onAction={action}
      />
    </div>,
  );
  const text = screen.getByLabelText(objective, { exact: true });
  await expect.element(text).toBeVisible();
  expect(text.element().scrollWidth).toBeGreaterThan(text.element().clientWidth);
  text.element().focus();
  await expect.element(screen.getByRole("tooltip")).toHaveTextContent(objective);
  const resume = screen.getByRole("button", { name: "Resume goal", exact: true });
  await resume.click();
  await expect.element(resume).toBeDisabled();
  await expect
    .element(screen.getByRole("button", { name: "Delete goal", exact: true }))
    .toBeDisabled();
  expect(action).toHaveBeenCalledExactlyOnceWith("resume");
  release();
  await expect.element(resume).toBeEnabled();
});
