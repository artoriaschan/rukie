import { expect, onTestFinished, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { createAppearance } from "../../src/lib/appearance";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import "../../src/theme.css";

test("appearance destination exposes one accessible three-choice theme control", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App host={{ getConnection: async () => connection, modelServices: modelServicesFixture }} />,
  );
  await screen.getByRole("button", { name: "Model services", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Appearance", exact: true }))
    .toBeEnabled();
  await screen.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect
    .element(screen.getByRole("radiogroup", { name: "Theme", exact: true }))
    .toBeVisible();
  expect(screen.getByRole("radio").elements()).toHaveLength(3);
});

function ownAppearance() {
  const saved = localStorage.getItem("rukie.appearance");
  const scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const owner = ownProjectBrowserTest();
  const appearances: ReturnType<typeof createAppearance>[] = [];
  onTestFinished(async () => {
    for (const appearance of appearances) appearance.dispose();
    vi.restoreAllMocks();
    try {
      await owner.close();
    } finally {
      try {
        if (saved === null) localStorage.removeItem("rukie.appearance");
        else localStorage.setItem("rukie.appearance", saved);
      } finally {
        await commands.colorScheme(scheme);
      }
    }
  });
  return {
    owner,
    create: (host?: Parameters<typeof createAppearance>[0]) => {
      const appearance = createAppearance(host);
      appearances.push(appearance);
      return appearance;
    },
  };
}

test.each([null, "invalid", "light", "dark"])(
  "initial theme is applied synchronously before App renders (%s)",
  async (stored) => {
    const { owner, create } = ownAppearance();
    await commands.colorScheme("dark");
    if (stored === null) localStorage.removeItem("rukie.appearance");
    else localStorage.setItem("rukie.appearance", stored);
    const appearance = create();
    // This is observed before React acquires a root, as in the renderer entry point.
    expect(document.documentElement.classList.contains("dark")).toBe(stored !== "light");
    expect(document.documentElement.classList.contains("light")).toBe(stored === "light");
    const connection = await owner.startWire();
    const screen = await owner.render(
      <App
        appearance={appearance}
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      />,
    );
    await screen.getByRole("button", { name: "Model services", exact: true }).click();
    await screen.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect
      .element(
        screen.getByRole("radio", {
          name: stored === "light" ? "Light" : stored === "dark" ? "Dark" : "System",
          exact: true,
        }),
      )
      .toHaveAttribute("aria-checked", "true");
  },
);

test("theme choices persist across renderer recreation and System alone follows native media changes", async () => {
  const { owner, create } = ownAppearance();
  localStorage.removeItem("rukie.appearance");
  await commands.colorScheme("light");
  const synchronizations: Promise<void>[] = [];
  const native = vi.fn((source: "system" | "light" | "dark") => {
    // Electron changes the renderer's media preference when themeSource changes.
    const synchronization = commands.colorScheme(source === "system" ? "light" : source);
    synchronizations.push(synchronization);
    return synchronization;
  });
  const appearance = create({ setThemeSource: native });
  try {
    const connection = await owner.startWire();
    const screen = await owner.render(
      <App
        appearance={appearance}
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      />,
    );
    await screen.getByRole("button", { name: "Model services", exact: true }).click();
    await screen.getByRole("button", { name: "Appearance", exact: true }).click();
    const radio = (name: string) => screen.getByRole("radio", { name, exact: true });
    await commands.colorScheme("dark");
    await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);
    await radio("Light").click();
    await expect.poll(() => matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
    expect(localStorage.getItem("rukie.appearance")).toBe("light");
    await commands.colorScheme("dark");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    await radio("Dark").click();
    expect(localStorage.getItem("rukie.appearance")).toBe("dark");
    await commands.colorScheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // Restore native forced-dark media, then return to the actual light system preference.
    await commands.colorScheme("dark");
    await radio("System").click();
    await expect.poll(() => document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem("rukie.appearance")).toBe("system");
    await commands.colorScheme("dark");
    await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);
    await radio("Light").click();
    appearance.dispose();
    const restored = create();
    expect(restored.getSnapshot()).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(native.mock.calls.map(([source]) => source)).toEqual([
      "system",
      "light",
      "dark",
      "system",
      "light",
    ]);
  } finally {
    await Promise.allSettled(synchronizations);
  }
});

test.each([
  { locale: "en", size: 14 },
  { locale: "zh", size: 18 },
] as const)(
  "appearance navigation and one radio tab stop remain usable at 420px ($locale/$size)",
  async ({ locale, size }) => {
    const { owner, create } = ownAppearance();
    localStorage.setItem("rukie.appearance", "system");
    await commands.colorScheme("light");
    await page.viewport(420, 900);
    document.documentElement.style.setProperty("--ui-font-size", `${size}px`);
    const appearance = create();
    const connection = await owner.startWire();
    const screen = await owner.render(
      <App
        locale={locale}
        appearance={appearance}
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      />,
    );
    await screen
      .getByRole("button", { name: locale === "en" ? "Model services" : "模型服务", exact: true })
      .click();
    const nav = screen.getByRole("button", {
      name: locale === "en" ? "Appearance" : "外观",
      exact: true,
    });
    await expect.element(nav).toBeVisible();
    const before = document
      .querySelector(".model-services-navigation-scroll")!
      .getBoundingClientRect();
    expect(before.width).toBe(52);
    await nav.click();
    const group = screen.getByRole("radiogroup", {
      name: locale === "en" ? "Theme" : "主题",
      exact: true,
    });
    await expect.element(group).toBeVisible();
    const radios = screen.getByRole("radio").elements();
    expect(radios.filter((e) => e.tabIndex === 0)).toHaveLength(1);
    for (const radio of radios) {
      expect(getComputedStyle(radio).cursor).toBe("pointer");
      for (const child of radio.closest("label")!.querySelectorAll("span"))
        expect(getComputedStyle(child).cursor).toBe("pointer");
    }
    (radios[0] as HTMLElement).focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(radios[1]!).toHaveFocus();
    await expect.element(radios[1]!).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(radios[0]!).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect.element(radios[0]!).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(420);
    const content = document.querySelector(".model-services-content")!;
    expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth + 1);
    expect(
      document.querySelector(".model-services-navigation-scroll")!.getBoundingClientRect().width,
    ).toBe(before.width);
  },
);

test("blocked renderer storage does not prevent choosing an appearance", async () => {
  const { owner, create } = ownAppearance();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const appearance = create();
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      appearance={appearance}
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  await screen.getByRole("button", { name: "Model services", exact: true }).click();
  await screen.getByRole("button", { name: "Appearance", exact: true }).click();
  await screen.getByRole("radio", { name: "Dark", exact: true }).click();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  vi.restoreAllMocks();
});

test("App keeps System following after leaving the appearance destination", async () => {
  const { owner } = ownAppearance();
  localStorage.setItem("rukie.appearance", "system");
  await commands.colorScheme("light");
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App host={{ getConnection: async () => connection, modelServices: modelServicesFixture }} />,
  );
  await screen.getByRole("button", { name: "Model services", exact: true }).click();
  await screen.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect
    .element(screen.getByRole("radio", { name: "System", exact: true }))
    .toHaveAttribute("aria-checked", "true");
  await screen.getByRole("button", { name: "Back", exact: true }).click();
  await commands.colorScheme("dark");
  await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);
  await screen.getByRole("button", { name: "Model services", exact: true }).click();
  await screen.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect
    .element(screen.getByRole("radio", { name: "System", exact: true }))
    .toHaveAttribute("aria-checked", "true");
});
