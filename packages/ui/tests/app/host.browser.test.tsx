import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { browserHost } from "../../src/host";
import "../../src/theme.css";

for (const outcome of ["selected", "cancelled", "unsupported"] as const) {
  test(`browser folder ${outcome} uses the app connection and falls back to manual entry`, async () => {
    await page.viewport(1280, 900);
    const connection = await commands.startWire();
    const url = `http://127.0.0.1:${connection.port}`;
    const original = location.href;
    history.replaceState(null, "", `#port=${connection.port}&token=${connection.token}`);
    const host = browserHost();
    expect(location.hash).toBe("");
    await fetch(`${url}/${outcome === "unsupported" ? "error" : "folder"}`, {
      method: "POST",
      body: JSON.stringify(
        outcome === "unsupported"
          ? { type: "host.pickFolder", code: "unsupported" }
          : outcome === "selected"
            ? "/chosen/project"
            : null,
      ),
    });
    const screen = await render(<App host={host} locale="en" />);
    try {
      await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
      await screen.getByRole("button", { name: "Add project", exact: true }).click();
      if (outcome !== "selected") {
        await screen.getByRole("textbox", { name: "Project folder path" }).fill("/manual/project");
        await screen.getByRole("button", { name: "Add", exact: true }).click();
      }
      await expect
        .poll(async () =>
          (await fetch(`${url}/commands`).then((response) => response.json())).filter(
            (command: { type: string }) => command.type === "project.add",
          ),
        )
        .toMatchObject([{ path: outcome === "selected" ? "/chosen/project" : "/manual/project" }]);
      if (outcome === "selected") {
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
      await screen.unmount();
      await commands.stopWire(connection.port);
      history.replaceState(null, "", original);
    }
  });
}
