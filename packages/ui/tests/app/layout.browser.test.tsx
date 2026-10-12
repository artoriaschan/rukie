import { modelServicesFixture } from "../helpers/model-services";
import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
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
    const root = document.documentElement;
    const previousStyle = root.getAttribute("style");
    const wasDark = root.classList.contains("dark");
    const connection = await commands.startWire();
    let screen: Awaited<ReturnType<typeof render>> | undefined;
    try {
      await page.viewport(width, height);
      root.classList.toggle("dark", dark);
      root.style.setProperty("--ui-font-size", `${fontSize}px`);
      screen = await render(
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
        dark ? "rgb(43, 40, 39)" : "rgb(233, 232, 232)",
      );
      expect(getComputedStyle(header).backgroundColor).toBe(
        dark ? "rgb(40, 41, 40)" : "rgb(232, 233, 233)",
      );
      expect(getComputedStyle(shell).borderRadius).toBe("16px");
      const workspace = main.parentElement!;
      expect(getComputedStyle(workspace).borderLeftWidth).toBe("0px");
      expect(getComputedStyle(workspace).borderTopWidth).toBe("0px");
      expect(getComputedStyle(workspace).borderRadius).toBe("12px");
      expect(getComputedStyle(main).backgroundColor).toBe(
        dark ? "rgb(24, 24, 24)" : "rgb(255, 255, 255)",
      );
      expect(getComputedStyle(document.body).fontFamily.startsWith("system-ui")).toBe(true);
      expect(
        getComputedStyle(
          screen.getByRole("button", { name: "Choose model" }).element(),
        ).fontFamily.startsWith("system-ui"),
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
            dark ? "rgb(31, 30, 30)" : "rgb(248, 247, 247)",
          );
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
      const scrollbar = screen.getByRole("scrollbar", { name: "Conversation scroll position" });
      await expect.element(scrollbar).toBeVisible();
      scrollbar.element().focus();
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
      try {
        await screen?.unmount();
      } finally {
        try {
          await commands.stopWire(connection.port);
        } finally {
          root.classList.toggle("dark", wasDark);
          if (previousStyle === null) root.removeAttribute("style");
          else root.setAttribute("style", previousStyle);
          await page.viewport(1280, 900);
        }
      }
    }
  },
);
