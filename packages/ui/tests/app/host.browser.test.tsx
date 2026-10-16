import { afterEach, beforeEach, expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { browserHost } from "../../src/host";
import "../../src/theme.css";

const connectionStorageKey = "rukie.webDevelopment.connection";
let previousConnection: string | null;
beforeEach(() => {
  previousConnection = sessionStorage.getItem(connectionStorageKey);
  sessionStorage.removeItem(connectionStorageKey);
});
afterEach(() => {
  if (previousConnection === null) sessionStorage.removeItem(connectionStorageKey);
  else sessionStorage.setItem(connectionStorageKey, previousConnection);
});

test("browser reconnects after reloading the cleaned development URL", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const original = location.href;
  let screen: Awaited<ReturnType<typeof render>> | undefined;
  try {
    history.replaceState(null, "", `#port=${connection.port}&token=${connection.token}`);
    expect(await browserHost().getConnection()).toEqual(connection);
    expect(location.hash).toBe("");
    // A full page reload reconstructs the host after the fragment has been removed.
    const restoredHost = browserHost();
    expect(await restoredHost.getConnection()).toEqual(connection);
    screen = await render(<App host={restoredHost} locale="en" />);
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Retry", exact: true }))
      .not.toBeInTheDocument();
  } finally {
    try {
      await screen?.unmount();
    } finally {
      try {
        await commands.stopWire(connection.port);
      } finally {
        history.replaceState(null, "", original);
      }
    }
  }
});

test("a new launch replaces the cached handshake and malformed fragments clear it", async () => {
  const original = location.href;
  try {
    history.replaceState(null, "", "#port=1234&token=old-fixture");
    await browserHost().getConnection();
    history.replaceState(null, "", "#port=5678&token=new-fixture");
    expect(await browserHost().getConnection()).toEqual({ port: 5678, token: "new-fixture" });
    expect(await browserHost().getConnection()).toEqual({ port: 5678, token: "new-fixture" });
    history.replaceState(null, "", "#port=invalid&token=fixture");
    await expect(browserHost().getConnection()).rejects.toMatchObject({
      code: "connection_missing",
    });
    expect(sessionStorage.getItem(connectionStorageKey)).toBeNull();
    await expect(browserHost().getConnection()).rejects.toMatchObject({
      code: "connection_missing",
    });
    history.replaceState(null, "", "#port=1234&token=invalid%20token");
    await expect(browserHost().getConnection()).rejects.toMatchObject({
      code: "connection_missing",
    });
    expect(sessionStorage.getItem(connectionStorageKey)).toBeNull();
  } finally {
    history.replaceState(null, "", original);
  }
});

for (const outcome of ["selected", "cancelled", "unsupported"] as const) {
  test(`browser folder ${outcome} uses the app connection and keeps the folder entry retryable`, async () => {
    await page.viewport(1280, 900);
    const connection = await commands.startWire();
    const url = `http://127.0.0.1:${connection.port}`;
    const original = location.href;
    let screen: Awaited<ReturnType<typeof render>> | undefined;
    try {
      history.replaceState(null, "", `#port=${connection.port}&token=${connection.token}`);
      const host = browserHost();
      expect(location.hash).toBe("");
      await fetch(`${url}/${outcome === "unsupported" ? "error" : "folder"}`, {
        method: "POST",
        body: JSON.stringify(
          outcome === "unsupported"
            ? { type: "host.pickFolder", code: "unsupported" }
            : outcome === "selected"
              ? ["/chosen/project"]
              : null,
        ),
      });
      screen = await render(<App host={host} locale="en" />);
      await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
      await screen.getByRole("button", { name: "Add project", exact: true }).click();
      const entry = screen.getByRole("button", {
        name: "Add folders Rukie can read and edit",
        exact: true,
      });
      await entry.click();
      await expect
        .element(screen.getByRole("textbox", { name: "Project folder path" }))
        .not.toBeInTheDocument();
      if (outcome !== "selected") {
        await expect.element(entry).toBeEnabled();
        await expect
          .element(screen.getByRole("button", { name: "Create project", exact: true }))
          .toBeDisabled();
        if (outcome === "unsupported")
          await expect
            .element(screen.getByRole("alert"))
            .toHaveTextContent("This action is unavailable on this platform.");
        else await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
        await fetch(`${url}/folder`, {
          method: "POST",
          body: JSON.stringify(["/retried/project"]),
        });
        await entry.click();
      }
      await screen.getByRole("button", { name: "Create project", exact: true }).click();
      await screen.getByRole("button", { name: "Trust and create", exact: true }).click();
      await expect
        .poll(async () =>
          (await fetch(`${url}/commands`).then((response) => response.json())).filter(
            (command: { type: string }) => command.type === "project.create",
          ),
        )
        .toMatchObject([
          {
            directories: [outcome === "selected" ? "/chosen/project" : "/retried/project"],
            trusted: true,
          },
        ]);
      if (outcome === "selected") {
        expect(await host.pickProjectFolder(false)).toEqual(["/chosen/project"]);
        expect(
          (await fetch(`${url}/commands`).then((response) => response.json())).filter(
            (command: { type: string; multiple?: boolean }) => command.type === "host.pickFolder",
          ),
        ).toMatchObject([
          { type: "host.pickFolder" },
          { type: "host.pickFolder", multiple: false },
        ]);
        await userEvent.keyboard("{Control>}1{/Control}");
        await screen.getByRole("button", { name: "Session actions" }).click();
        const open = screen.getByRole("menuitem", { name: "Open with", exact: true });
        await open.hover();
        await screen.getByRole("menuitem", { name: "Show in Finder", exact: true }).click();
        await expect
          .poll(async () =>
            (await fetch(`${url}/commands`).then((response) => response.json())).filter(
              (command: { type: string }) => command.type === "host.revealPath",
            ),
          )
          .toMatchObject([{ path: "/project" }]);
        await screen.getByRole("button", { name: "Session actions" }).click();
        await screen.getByRole("menuitem", { name: "Open with", exact: true }).hover();
        await screen.getByRole("menuitem", { name: "Open in Terminal", exact: true }).click();
        await expect
          .poll(async () =>
            (await fetch(`${url}/commands`).then((response) => response.json())).filter(
              (command: { type: string }) => command.type === "host.openInTerminal",
            ),
          )
          .toMatchObject([{ path: "/project" }]);
      }
    } finally {
      try {
        await screen?.unmount();
      } finally {
        try {
          await commands.stopWire(connection.port);
        } finally {
          history.replaceState(null, "", original);
        }
      }
    }
  });
}

test("browser model service settings autosave, reveal and delete through the single app connection", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const original = location.href;
  let screen: Awaited<ReturnType<typeof render>> | undefined;
  try {
    history.replaceState(null, "", `#port=${connection.port}&token=${connection.token}`);
    const host = browserHost();
    screen = await render(<App host={host} locale="en" />);
    await screen.getByRole("button", { name: "Model services", exact: true }).click();
    await screen.getByRole("button", { name: "Add provider", exact: true }).first().click();
    await screen.getByRole("button", { name: "Create custom provider" }).click();
    await screen.getByRole("textbox", { name: "Base URL" }).fill("http://127.0.0.1:1");
    await screen.getByLabelText("API Key", { exact: true }).fill("browser-wire-fixture");
    await expect
      .poll(async () => (await host.modelServices.list())[0])
      .toMatchObject({ baseUrl: "http://127.0.0.1:1", hasCredential: true });
    await expect.element(screen.getByLabelText("API Key", { exact: true })).toHaveValue("");
    const providerId = (await host.modelServices.list())[0]!.id;
    expect(
      await host.modelServices.prices({ baseUrl: "http://127.0.0.1:1", modelId: "fixture" }),
    ).toEqual({ status: "unavailable" });
    await host.modelServices.test(providerId, "fixture");
    await screen.getByRole("button", { name: "Show API Key", exact: true }).click();
    await expect
      .element(screen.getByLabelText("API Key", { exact: true }))
      .toHaveValue("browser-wire-fixture");
    await screen.getByRole("button", { name: "Hide API Key", exact: true }).click();
    await expect.element(screen.getByLabelText("API Key", { exact: true })).toHaveValue("");
    await screen.getByRole("button", { name: "Provider actions", exact: true }).click();
    await screen.getByRole("menuitem", { name: "Delete provider", exact: true }).click();
    await screen.getByRole("button", { name: "Confirm delete", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Add provider", exact: true }).first())
      .toBeVisible();
  } finally {
    try {
      await screen?.unmount();
    } finally {
      try {
        await commands.stopWire(connection.port);
      } finally {
        history.replaceState(null, "", original);
      }
    }
  }
});

test("browser theme source is a local no-op without an active connection", async () => {
  const original = location.href;
  const saved = sessionStorage.getItem("rukie.webDevelopment.connection");
  try {
    history.replaceState(null, "", location.pathname);
    sessionStorage.removeItem("rukie.webDevelopment.connection");
    const host = browserHost();
    await host.setThemeSource("system");
    await host.setThemeSource("light");
    await host.setThemeSource("dark");
  } finally {
    history.replaceState(null, "", original);
    if (saved === null) sessionStorage.removeItem("rukie.webDevelopment.connection");
    else sessionStorage.setItem("rukie.webDevelopment.connection", saved);
  }
});
