import { modelServicesFixture } from "../helpers/model-services";
import { expect, onTestFinished, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { render } from "vitest-browser-react";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import { App } from "../../src/app";
import "../../src/theme.css";

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

function within(element: Element, container: Element) {
  const box = element.getBoundingClientRect();
  const boundary = container.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.left).toBeGreaterThanOrEqual(boundary.left - 1);
  expect(box.right).toBeLessThanOrEqual(boundary.right + 1);
  expect(box.top).toBeGreaterThanOrEqual(boundary.top - 1);
  expect(box.bottom).toBeLessThanOrEqual(boundary.bottom + 1);
}

// These are the existing shell's measured region boundaries, not CSS class snapshots.
// The narrow sidebar overlays the conversation; the desktop sidebar consumes 268px.
test.each([
  { width: 1280, height: 900, dark: false, fontSize: 14 },
  { width: 420, height: 700, dark: true, fontSize: 18 },
])(
  "page regions preserve geometry at $width px, font $fontSize",
  async ({ width, height, dark, fontSize }) => {
    const owner = ownProjectBrowserTest();
    const root = document.documentElement;
    const connection = await owner.startWire();
    let screen: Awaited<ReturnType<typeof render>> | undefined;
    try {
      await page.viewport(width, height);
      root.classList.toggle("dark", dark);
      root.style.setProperty("--ui-font-size", `${fontSize}px`);
      screen = await owner.render(
        <App
          host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
          locale="en"
        />,
      );
      await expect.element(screen.getByRole("button", { name: "Choose model" })).toBeEnabled();
      if (width < 768)
        await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
      await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
      const header = screen.getByRole("banner").element();
      const navigation = screen.getByRole("navigation", { name: "Home", exact: true }).element();
      const main = screen.getByRole("main").element();
      const toggle = screen.getByRole("button", { name: "Toggle sidebar", exact: true });
      const shell = document.querySelector("[data-workspace-shell]")!;
      expect(getComputedStyle(shell).backgroundColor).toBe(
        dark ? "rgb(14, 14, 14)" : "rgb(247, 247, 247)",
      );
      expect(getComputedStyle(header).backgroundColor).toBe(
        dark ? "rgb(14, 14, 14)" : "rgb(247, 247, 247)",
      );
      expect(getComputedStyle(shell).borderRadius).toBe("16px");
      const workspace = main.parentElement!;
      expect(getComputedStyle(workspace).borderLeftWidth).toBe("0px");
      expect(getComputedStyle(workspace).borderTopWidth).toBe("0px");
      expect(getComputedStyle(workspace).borderRadius).toBe("12px");
      expect(getComputedStyle(shell).overflow).toBe("hidden");
      expect(getComputedStyle(workspace).boxShadow).toBe(
        dark
          ? "rgba(0, 0, 0, 0.25) 0px 2px 8px 0px, rgba(0, 0, 0, 0.45) 0px 8px 24px 0px"
          : "rgba(0, 0, 0, 0.04) 0px 2px 8px 0px, rgba(0, 0, 0, 0.06) 0px 8px 24px 0px",
      );
      for (const region of [shell, header, navigation, main])
        expect(getComputedStyle(region).boxShadow).toBe("none");
      expect(getComputedStyle(main).backgroundColor).toBe(
        dark ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)",
      );
      expect(
        getComputedStyle(document.body).fontFamily.startsWith('"Noto Sans SC", system-ui'),
      ).toBe(true);
      expect(
        getComputedStyle(
          screen.getByRole("button", { name: "Choose model" }).element(),
        ).fontFamily.startsWith('"Noto Sans SC", system-ui'),
      ).toBe(true);
      expect(
        [...document.fonts].some((face) =>
          /Noto Sans SC Variable|JetBrains Mono Variable/.test(face.family),
        ),
      ).toBe(false);
      const input = screen.getByRole("textbox", { name: "Prompt", exact: true });
      const form = input.element().closest("form")!;
      const controls = ["Attach images", "Permission mode", "Choose model", "Send prompt"];
      const assertRegions = (sidebarOpen: boolean) => {
        const headerBox = header.getBoundingClientRect();
        near(headerBox.left, 0);
        near(headerBox.top, 0);
        near(headerBox.width, width);
        near(headerBox.height, 44);
        near(toggle.element().getBoundingClientRect().left, 156);
        const nav = navigation.getBoundingClientRect();
        near(nav.left, 0);
        near(nav.top, 44);
        near(nav.width, 52);
        near(nav.bottom, height);
        const conversation = main.getBoundingClientRect();
        const left = width >= 768 && sidebarOpen ? 320 : 52;
        near(conversation.left, left);
        near(conversation.top, 44);
        near(conversation.right, width - 4);
        near(conversation.bottom, height - 4);
        const composer = form.getBoundingClientRect();
        const padding = width >= 640 ? 24 : 12;
        // Authorized Pencil C04 change: 752px composer plus the existing 24px side padding.
        const dockWidth = Math.min(800, conversation.width);
        near(composer.width, dockWidth - padding * 2);
        near(composer.left, left + (conversation.width - dockWidth) / 2 + padding);
        near(composer.bottom, height - 20);
        within(form, main);
        within(input.element(), form);
        for (const name of controls)
          within(screen!.getByRole("button", { name, exact: true }).element(), form);
        expect(root.scrollWidth).toBeLessThanOrEqual(width);
        expect(root.scrollHeight).toBeLessThanOrEqual(height);
        expect(window.scrollY).toBe(0);
        if (sidebarOpen) {
          const sidebar = screen!
            .getByRole("button", { name: "New chat", exact: true })
            .element()
            .closest("aside")!;
          const side = sidebar.getBoundingClientRect();
          near(side.left, 52);
          near(side.top, 44);
          near(side.width, 268);
          near(side.bottom, height - 4);
          expect(getComputedStyle(sidebar).backgroundColor).toBe(
            dark ? "rgb(5, 5, 5)" : "rgb(252, 252, 252)",
          );
          expect(getComputedStyle(sidebar).boxShadow).toBe("none");
          expect(getComputedStyle(sidebar).borderLeftWidth).toBe("0px");
          expect(getComputedStyle(sidebar).borderRightWidth).toBe("1px");
          expect(getComputedStyle(sidebar).borderRightColor).toBe(
            dark ? "rgba(255, 255, 255, 0.1)" : "rgba(13, 13, 13, 0.1)",
          );
        }
      };

      const welcome = screen.getByRole("heading", { name: /What would you/ }).element();
      within(welcome, main);
      assertRegions(true);
      await toggle.click();
      await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
      assertRegions(false);
      await toggle.click();
      await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
      assertRegions(true);

      // Select a real Session through the shell shortcut, including narrow-overlay dismissal.
      await userEvent.keyboard("{Control>}1{/Control}");
      await expect
        .element(screen.getByRole("heading", { name: "Fix compiler", exact: true }))
        .toBeVisible();
      const feed = screen.getByRole("feed").element();
      const selectedSidebarOpen = width >= 768;
      await expect.element(toggle).toHaveAttribute("aria-pressed", String(selectedSidebarOpen));
      // Session selection replaces the welcome footer. Read the new form, not a detached element.
      const selectedInput = screen.getByRole("textbox", { name: "Prompt", exact: true });
      const selectedForm = selectedInput.element().closest("form")!;
      const footer = selectedForm.parentElement!.parentElement!;
      const assertConversation = (sidebarOpen = selectedSidebarOpen) => {
        const bounds = main.getBoundingClientRect();
        near(bounds.left, width >= 768 && sidebarOpen ? 320 : 52);
        near(bounds.top, 44);
        near(bounds.right, width - 4);
        near(bounds.bottom, height - 4);
        near(feed.getBoundingClientRect().top, bounds.top);
        near(feed.getBoundingClientRect().bottom, footer.getBoundingClientRect().top);
        near(feed.getBoundingClientRect().left, bounds.left);
        near(feed.getBoundingClientRect().right, bounds.right);
        const composer = selectedForm.getBoundingClientRect();
        const dockWidth = Math.min(800, bounds.width);
        const padding = width >= 640 ? 24 : 12;
        near(composer.width, dockWidth - padding * 2);
        near(composer.left, bounds.left + (bounds.width - dockWidth) / 2 + padding);
        near(composer.bottom, height - 20);
        within(selectedForm, main);
        within(selectedInput.element(), selectedForm);
        for (const name of controls)
          within(screen!.getByRole("button", { name, exact: true }).element(), selectedForm);
        const titlebar = header.getBoundingClientRect();
        near(titlebar.left, 0);
        near(titlebar.top, 0);
        near(titlebar.width, width);
        near(titlebar.height, 44);
        const nav = navigation.getBoundingClientRect();
        near(nav.left, 0);
        near(nav.top, 44);
        near(nav.width, 52);
        near(nav.bottom, height);
        near(toggle.element().getBoundingClientRect().left, 156);
        expect(root.scrollWidth).toBeLessThanOrEqual(width);
        expect(root.scrollHeight).toBeLessThanOrEqual(height);
      };
      assertConversation();
      if (width >= 768)
        expect(getComputedStyle(header.lastElementChild!).borderLeftColor).toBe(
          dark ? "rgba(255, 255, 255, 0.1)" : "rgba(13, 13, 13, 0.1)",
        );
      await toggle.click();
      await expect.element(toggle).toHaveAttribute("aria-pressed", String(!selectedSidebarOpen));
      assertConversation(!selectedSidebarOpen);
      await toggle.click();
      await expect.element(toggle).toHaveAttribute("aria-pressed", String(selectedSidebarOpen));
      assertConversation();
      const shortFormHeight = selectedForm.getBoundingClientRect().height;
      const shortFeedHeight = feed.getBoundingClientRect().height;
      await selectedInput.fill(
        Array.from({ length: 12 }, (_, index) => `Draft line ${index + 1}`).join("\n"),
      );
      await expect
        .poll(() => selectedForm.getBoundingClientRect().height)
        .toBeGreaterThan(shortFormHeight);
      assertConversation();
      const growth = selectedForm.getBoundingClientRect().height - shortFormHeight;
      near(shortFeedHeight - feed.getBoundingClientRect().height, growth);
      await selectedInput.fill("");
      await expect.poll(() => selectedForm.getBoundingClientRect().height).toBe(shortFormHeight);

      const messages = Array.from({ length: 16 }, (_, index) => ({
        role: "user",
        entryId: `layout-${index}`,
        timestamp: index + 1,
        content: `Layout message ${index + 1}\n${"Long conversation content.\n".repeat(12)}`,
      }));
      let lag: { liveMax: number; cachedMax: number; topAfterEnd: number } | undefined;
      const track = document.querySelector<HTMLElement>(
        '[role="scrollbar"][aria-label="Conversation scroll position"]',
      )!;
      const measurement = new ResizeObserver(() => {
        const liveMax = feed.scrollHeight - feed.clientHeight;
        const cachedMax = Number(track.getAttribute("aria-valuemax"));
        if (width !== 1280 || lag || cachedMax <= 0 || liveMax <= cachedMax) return;
        // Native row measurement changes height before the scrollbar's deferred RAF update.
        // Dispatch the public key at that observable boundary rather than waiting a guessed delay.
        track.focus();
        track.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
        lag = { liveMax, cachedMax, topAfterEnd: feed.scrollTop };
        measurement.disconnect();
      });
      onTestFinished(() => measurement.disconnect());
      measurement.observe(feed.firstElementChild!);
      try {
        await fetch(`http://127.0.0.1:${connection.port}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "snapshot",
            sessionId: "one",
            model: "test/script",
            messages,
            compactions: [],
            queuedInputs: [],
            toolStates: {},
            background: [],
            runSummaries: [],
          }),
        });
        await expect.poll(() => feed.scrollHeight).toBeGreaterThan(feed.clientHeight);
        if (width === 1280) {
          await expect.poll(() => lag).toBeDefined();
          expect(lag!.liveMax).toBeGreaterThan(lag!.cachedMax);
          expect(lag!.liveMax - lag!.topAfterEnd).toBeLessThanOrEqual(1);
        }
      } finally {
        measurement.disconnect();
      }
      const scrollbar = screen.getByRole("scrollbar", { name: "Conversation scroll position" });
      await expect.element(scrollbar).toBeVisible();
      // Settle the complete snapshot's final measured row and the rendered scrollbar extent.
      await expect
        .poll(() => {
          const last = feed.querySelector('article[aria-posinset="16"]');
          if (!last) return Infinity;
          return (
            last.getBoundingClientRect().bottom -
            feed.getBoundingClientRect().top +
            feed.scrollTop -
            feed.scrollHeight
          );
        })
        .toBeLessThanOrEqual(1);
      await expect
        .poll(
          () =>
            Number(scrollbar.element().getAttribute("aria-valuemax")) -
            Math.round(feed.scrollHeight - feed.clientHeight),
        )
        .toBe(0);
      scrollbar.element().focus();
      await userEvent.keyboard("{Home}");
      await expect.poll(() => feed.scrollTop).toBe(0);
      await userEvent.keyboard("{End}");
      await expect
        .poll(() => feed.scrollHeight - feed.clientHeight - feed.scrollTop)
        .toBeLessThanOrEqual(1);
      assertConversation();
      await userEvent.keyboard("{Home}");
      await expect.poll(() => feed.scrollTop).toBe(0);
      assertConversation();
      await userEvent.keyboard("{PageDown}");
      await expect.poll(() => feed.scrollTop).toBeGreaterThan(0);
      expect(feed.scrollTop).toBeLessThan(feed.scrollHeight - feed.clientHeight);
      assertConversation();
      expect(window.scrollY).toBe(0);
      expect(footer.scrollTop).toBe(0);
      // Height-only resize must grow the Transcript, without moving the title bar or widening the dock.
      const beforeResize = feed.getBoundingClientRect().height;
      height += 100;
      await page.viewport(width, height);
      await expect.poll(() => feed.getBoundingClientRect().height).toBe(beforeResize + 100);
      assertConversation();
      // Cross the responsive breakpoint with an existing Session and retained sidebar state.
      // An open sidebar switches between consuming space and overlaying the conversation.
      const originalWidth = width;
      width = width >= 768 ? 420 : 1280;
      await page.viewport(width, height);
      await expect.poll(() => header.getBoundingClientRect().width).toBe(width);
      await expect.element(toggle).toHaveAttribute("aria-pressed", String(selectedSidebarOpen));
      assertConversation();
      await toggle.click();
      await expect.element(toggle).toHaveAttribute("aria-pressed", String(!selectedSidebarOpen));
      assertConversation(!selectedSidebarOpen);
      await toggle.click();
      width = originalWidth;
      await page.viewport(width, height);
      await expect.poll(() => header.getBoundingClientRect().width).toBe(width);
      assertConversation();
    } finally {
      await owner.close();
    }
  },
);

test.each([1280, 420])(
  "sidebar keeps its top fixed and overlays its scrollbar at %i px",
  async (width) => {
    const owner = ownProjectBrowserTest();
    await page.viewport(width, 700);
    const connection = await owner.startWire();
    const screen = await owner.render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale="en"
      />,
    );
    try {
      if (width < 768)
        await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
      await expect
        .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
        .toBeVisible();
      await fetch(`http://127.0.0.1:${connection.port}/message`, {
        method: "POST",
        body: JSON.stringify({
          type: "sessions_changed",
          homeDir: "/fixture-home",
          projects: [],
          pinned: [],
          archived: [],
          preferences: {},
          sessions: Array.from({ length: 30 }, (_, index) => ({
            id: `scroll-${index}`,
            title: `Scroll Session ${index}`,
            titleSource: "prompt",
            cwd: "/workspace",
            projectId: null,
            worktree: null,
            model: "test/script",
            createdAt: index,
            updatedAt: index,
            messageCount: 1,
          })),
        }),
      });
      const sidebar = screen.getByRole("complementary", { name: "Home", exact: true }).element();
      const newChat = screen.getByRole("button", { name: "New chat", exact: true }).element();
      expect(newChat.querySelector("kbd")).toBeNull();
      const top = newChat.getBoundingClientRect();
      const viewport = sidebar.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
      expect(viewport).not.toBeNull();
      await expect.poll(() => viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
      const before = viewport.getBoundingClientRect();
      near(before.bottom, sidebar.getBoundingClientRect().bottom - 8);
      expect(before.top).toBeGreaterThan(top.bottom);
      const divider = sidebar.querySelector('[data-slot="separator"]')!;
      const separatorBox = divider.getBoundingClientRect();
      expect(separatorBox.height).toBe(1);
      expect(getComputedStyle(divider).opacity).toBe("0");
      const scrollbar = screen.getByRole("scrollbar", { name: "Session navigation", exact: true });
      await expect.element(scrollbar).toBeVisible();
      near(scrollbar.element().getBoundingClientRect().width, 8);
      const row = screen.getByRole("button", { name: "Scroll Session 29", exact: true }).element();
      expect(row.parentElement!.getBoundingClientRect().right).toBeGreaterThan(before.right - 9);
      scrollbar.element().focus();
      await userEvent.keyboard("{End}");
      await expect
        .poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop)
        .toBeLessThanOrEqual(1);
      await expect.poll(() => getComputedStyle(divider).opacity).toBe("1");
      await userEvent.keyboard("{Home}");
      await expect.poll(() => viewport.scrollTop).toBe(0);
      await expect.poll(() => getComputedStyle(divider).opacity).toBe("0");
      await userEvent.keyboard("{End}");
      await expect.poll(() => getComputedStyle(divider).opacity).toBe("1");
      await fetch(`http://127.0.0.1:${connection.port}/message`, {
        method: "POST",
        body: JSON.stringify({
          type: "sessions_changed",
          homeDir: "/fixture-home",
          projects: [],
          pinned: [],
          archived: [],
          preferences: {},
          sessions: [],
        }),
      });
      await expect.poll(() => viewport.scrollHeight <= viewport.clientHeight).toBe(true);
      await expect.poll(() => getComputedStyle(divider).opacity).toBe("0");
      near(newChat.getBoundingClientRect().top, top.top);
      near(divider.getBoundingClientRect().top, separatorBox.top);
      near(viewport.getBoundingClientRect().width, before.width);
      near(sidebar.getBoundingClientRect().width, 268);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(window.scrollY).toBe(0);
      await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
      near(screen.getByRole("main").element().getBoundingClientRect().left, 52);
    } finally {
      await owner.close();
    }
  },
);

test.each([1280, 420])("settings shell preserves surfaces and geometry at %i px", async (width) => {
  const owner = ownProjectBrowserTest();
  const root = document.documentElement;
  const connection = await owner.startWire();
  let screen: Awaited<ReturnType<typeof render>> | undefined;
  try {
    await page.viewport(width, 900);
    screen = await owner.render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale="en"
      />,
    );
    await screen.getByRole("button", { name: "Model services", exact: true }).click();
    const settings = screen.getByRole("region", { name: "Model services", exact: true }).element();
    const navigation = settings.querySelector(".model-services-navigation-scroll")!;
    const main = settings.querySelector(".model-services-content-scroll")!;
    const header = screen.getByRole("banner").element();
    const shell = document.querySelector("[data-workspace-shell]")!;
    const panel = settings.querySelector(".model-services-panel")!;
    await expect
      .element(screen.getByRole("heading", { name: "Model services", exact: true }))
      .toBeVisible();
    for (const dark of [false, true]) {
      root.classList.toggle("dark", dark);
      const bounds = settings.getBoundingClientRect();
      near(bounds.left, width === 1280 ? 52 : 0);
      near(bounds.top, 44);
      near(bounds.right, width === 1280 ? width - 4 : width);
      near(bounds.bottom, width === 1280 ? 896 : 900);
      near(header.getBoundingClientRect().height, 44);
      near(navigation.getBoundingClientRect().width, width === 1280 ? 268 : 52);
      near(main.getBoundingClientRect().left, width === 1280 ? 320 : 52);
      expect(getComputedStyle(settings).borderRadius).toBe("12px");
      expect(getComputedStyle(shell).overflow).toBe("hidden");
      expect(getComputedStyle(settings).backgroundColor).toBe(
        dark ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)",
      );
      expect(getComputedStyle(navigation).backgroundColor).toBe(
        dark ? "rgb(5, 5, 5)" : "rgb(252, 252, 252)",
      );
      expect(getComputedStyle(settings).boxShadow).toBe(
        dark
          ? "rgba(0, 0, 0, 0.25) 0px 2px 8px 0px, rgba(0, 0, 0, 0.45) 0px 8px 24px 0px"
          : "rgba(0, 0, 0, 0.04) 0px 2px 8px 0px, rgba(0, 0, 0, 0.06) 0px 8px 24px 0px",
      );
      expect(getComputedStyle(shell).backgroundColor).toBe(
        dark ? "rgb(14, 14, 14)" : "rgb(247, 247, 247)",
      );
      expect(getComputedStyle(header).backgroundColor).toBe(
        getComputedStyle(shell).backgroundColor,
      );
      const inactiveWorkspace = document.querySelector(".app-workspace")!;
      for (const region of [shell, header, navigation, main, inactiveWorkspace])
        expect(getComputedStyle(region).boxShadow).toBe("none");
      expect(
        getComputedStyle(settings.querySelector(".model-services-navigation")!).borderRightWidth,
      ).toBe("1px");
      expect(
        getComputedStyle(settings.querySelector(".model-services-navigation")!).borderRightColor,
      ).toBe(dark ? "rgba(255, 255, 255, 0.1)" : "rgba(13, 13, 13, 0.1)");
      expect(getComputedStyle(panel).backgroundColor).toBe(
        dark ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)",
      );
      expect(root.scrollWidth).toBeLessThanOrEqual(width);
      expect(root.scrollHeight).toBeLessThanOrEqual(900);
      expect(window.scrollY).toBe(0);
    }
  } finally {
    await owner.close();
  }
});
