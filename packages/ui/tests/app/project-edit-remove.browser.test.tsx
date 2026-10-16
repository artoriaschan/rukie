import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import type { render } from "vitest-browser-react";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import { App } from "../../src/app";
import type { WireProject, WireSessionSummary } from "@rukie/shared";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

function buttonContrast(element: Element) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const paint = canvas.getContext("2d");
  if (!paint) throw new Error("Canvas color conversion unavailable");
  const channels = (color: string) => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = color;
    paint.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = paint.getImageData(0, 0, 1, 1).data;
    return [red!, green!, blue!, alpha! / 255];
  };
  let background = [255, 255, 255];
  const ancestors: Element[] = [];
  for (let parent: Element | null = element; parent; parent = parent.parentElement)
    ancestors.unshift(parent);
  for (const parent of ancestors) {
    const color = channels(getComputedStyle(parent).backgroundColor);
    const alpha = color[3] ?? 1;
    background = background.map((value, index) => color[index]! * alpha + value * (1 - alpha));
  }
  const luminance = (color: number[]) =>
    color
      .slice(0, 3)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  const text = luminance(channels(getComputedStyle(element).color));
  const surface = luminance(background);
  return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
}

const requests = async (port: number): Promise<Record<string, unknown>[]> =>
  (await fetch(`http://127.0.0.1:${port}/commands`)).json();

test("pending Project save blocks duplicate submission and closing until the response", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    const dialog = await openEditor(screen);
    await dialog.getByRole("textbox").fill("Saved once");
    await fetch(`http://127.0.0.1:${connection.port}/hold`, { method: "POST" });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(dialog.getByRole("textbox")).toBeDisabled();
    for (const name of ["Save", "Cancel", "Close", "Remove local project"])
      await expect.element(dialog.getByRole("button", { name, exact: true })).toBeDisabled();
    await dialog.getByRole("heading", { name: "Edit project", exact: true }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).toBeVisible();
    expect(
      (await requests(connection.port)).filter((request) => request.type === "project.update"),
    ).toHaveLength(1);
    await fetch(`http://127.0.0.1:${connection.port}/flush`, { method: "POST" });
    await expect.element(dialog).not.toBeInTheDocument();
  } finally {
    await owner.close();
  }
});

test("unsupported edit folder picking shows a retryable alert and preserves the Project draft", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    const dialog = await openEditor(screen);
    await dialog.getByRole("textbox").fill("Keep my draft");
    const add = dialog.getByRole("button", { name: "Add folder", exact: true });
    await add.click();
    await expect
      .element(dialog.getByRole("alert"))
      .toHaveTextContent("This action is unavailable on this platform.");
    await expect.element(add).toBeEnabled();
    await expect.element(dialog.getByRole("textbox")).toHaveValue("Keep my draft");
    await expect.element(dialog.getByText("project", { exact: true })).toBeVisible();
    await expect
      .element(dialog.getByRole("textbox", { name: "Folder path", exact: true }))
      .not.toBeInTheDocument();
  } finally {
    await owner.close();
  }
});

const project: WireProject = {
  id: "project",
  name: "Project",
  directories: ["/project", "/second"],
  primary: "/project",
  trusted: true,
};
const session: WireSessionSummary = {
  id: "one",
  title: "Existing history",
  titleSource: "prompt",
  cwd: "/project",
  projectId: "project",
  worktree: null,
  model: "test/script",
  createdAt: 1,
  updatedAt: 2,
  messageCount: 1,
};
async function changeProjects(
  port: number,
  projects: WireProject[],
  sessions = [session],
  pinned: string[] = [],
  archived: string[] = [],
) {
  await fetch(`http://127.0.0.1:${port}/message`, {
    method: "POST",
    body: JSON.stringify({
      type: "sessions_changed",
      homeDir: "/fixture-home",
      projects,
      sessions,
      pinned,
      archived,
      preferences: {},
    }),
  });
}
async function openEditor(
  screen: Awaited<ReturnType<typeof render>>,
  name = "Project",
  zh = false,
) {
  // The new-chat Project menu (C33) only selects; editing is reached from the Project detail card.
  const row = screen
    .getByRole("region", { name: zh ? "项目" : "Projects", exact: true })
    .getByRole("button", { name, exact: true });
  // Narrow windows start with the sidebar collapsed.
  if (!matchMedia("(min-width: 768px)").matches)
    await screen
      .getByRole("button", { name: zh ? "切换侧栏" : "Toggle sidebar", exact: true })
      .click();
  await expect.element(row).toBeVisible();
  row.element().focus();
  const card = screen.getByRole("dialog", {
    name: zh ? "项目详情" : "Project details",
    exact: true,
  });
  await card.getByRole("button", { name: zh ? "编辑项目" : "Edit project", exact: true }).click();
  return screen.getByRole("dialog", { name: zh ? "编辑项目" : "Edit project", exact: true });
}

test("editing a Project submits one complete draft and leaves unchanged or nameless drafts disabled", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    const dialog = await openEditor(screen);
    const name = dialog.getByRole("textbox", { name: "Project name", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await expect.element(name).toHaveValue("Project");
    await expect.element(name).toHaveFocus();
    await expect.element(save).toBeDisabled();
    await expect
      .element(dialog.getByRole("button", { name: "Remove folder /project", exact: true }))
      .toBeDisabled();
    await name.fill("  ");
    await expect.element(save).toBeDisabled();
    await name.fill("  Renamed Project  ");
    await save.click();
    await expect.element(dialog).not.toBeInTheDocument();
    await expect
      .poll(() => requests(connection.port))
      .toContainEqual(
        expect.objectContaining({
          type: "project.update",
          projectId: "project",
          name: "Renamed Project",
          directories: ["/project"],
          primary: "/project",
        }),
      );
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.trust" }),
    );
    await expect
      .element(
        screen
          .getByRole("region", { name: "Projects", exact: true })
          .getByRole("button", { name: "Renamed Project", exact: true }),
      )
      .toBeVisible();
  } finally {
    await owner.close();
  }
});

test("trusted Project additions confirm all folders, mark new folders and retain the draft on cancellation", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => ["/third"],
      }}
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await changeProjects(connection.port, [project]);
    let dialog = await openEditor(screen);
    await dialog.getByRole("textbox").fill("Combined repos");
    await dialog.getByRole("button", { name: "Add folder", exact: true }).click();
    await dialog.getByRole("button", { name: "Remove folder /project", exact: true }).click();
    await expect
      .element(dialog.getByRole("button", { name: "Set as primary /second", exact: true }))
      .not.toBeInTheDocument();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const trust = screen.getByRole("dialog", { name: "Trust these folders?", exact: true });
    await expect.element(trust.getByText("/second", { exact: true })).toBeVisible();
    await expect.element(trust.getByText("/third", { exact: true })).toBeVisible();
    const rows = trust.element().querySelectorAll("li");
    expect(rows[0]!.textContent).toContain("Primary");
    expect(rows[0]!.textContent).not.toContain("New");
    expect(rows[1]!.textContent).toContain("New");
    for (const action of ["Cancel", "Close", "Escape"]) {
      if (action === "Escape") {
        await trust.getByRole("heading", { name: "Trust these folders?", exact: true }).click();
        await userEvent.keyboard("{Escape}");
      } else await trust.getByRole("button", { name: action, exact: true }).click();
      dialog = screen.getByRole("dialog", { name: "Edit project", exact: true });
      await expect.element(dialog.getByRole("textbox")).toHaveValue("Combined repos");
      await expect.element(dialog.getByText("third", { exact: true })).toBeVisible();
      if (action !== "Escape")
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
    }
    dialog = screen.getByRole("dialog", { name: "Edit project", exact: true });
    await expect.element(dialog.getByRole("textbox")).toHaveValue("Combined repos");
    await expect.element(dialog.getByText("third", { exact: true })).toBeVisible();
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.update" }),
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await screen.getByRole("button", { name: "Trust and save", exact: true }).click();
    await expect
      .poll(() => requests(connection.port))
      .toContainEqual(
        expect.objectContaining({
          type: "project.update",
          projectId: "project",
          name: "Combined repos",
          directories: ["/second", "/third"],
          primary: "/second",
          trusted: true,
        }),
      );
    await expect
      .element(
        screen
          .getByRole("region", { name: "Projects", exact: true })
          .getByRole("button", { name: "Combined repos", exact: true }),
      )
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("region", { name: "Projects", exact: true })
          .getByRole("button", { name: "Existing history", exact: true }),
      )
      .toBeVisible();
  } finally {
    await owner.close();
  }
});

test("untrusted Project additions save directly without granting trust", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => ["/third"],
      }}
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await changeProjects(connection.port, [{ ...project, trusted: false }]);
    await screen
      .getByRole("main")
      .getByRole("button", { name: "Conversation", exact: true })
      .click();
    await screen.getByRole("menuitem", { name: "Project", exact: true }).click();
    await screen.getByRole("button", { name: "Cancel", exact: true }).click();
    const dialog = await openEditor(screen);
    await dialog.getByRole("button", { name: "Add folder", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    const updates = (await requests(connection.port)).filter(
      (request) => request.type === "project.update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      directories: ["/project", "/second", "/third"],
      primary: "/project",
    });
    expect(updates[0]).not.toHaveProperty("trusted");
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.trust" }),
    );
  } finally {
    await owner.close();
  }
});

test("cancel, close and Escape discard the entire Project edit draft", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await changeProjects(connection.port, [project]);
    for (const action of ["Cancel", "Close", "Escape"]) {
      // Reopening the editor for the same Project does not recreate the App.
      const dialog = await openEditor(screen);
      await expect.element(dialog.getByRole("textbox")).toHaveValue("Project");
      await expect.element(dialog.getByText("project", { exact: true })).toBeVisible();
      await dialog.getByRole("textbox").fill("Discard me");
      await dialog.getByRole("button", { name: "Remove folder /project", exact: true }).click();
      await expect.element(dialog.getByRole("textbox")).toHaveFocus();
      if (action === "Escape") {
        await dialog.getByRole("heading", { name: "Edit project", exact: true }).click();
        await userEvent.keyboard("{Escape}");
      } else await dialog.getByRole("button", { name: action, exact: true }).click();
      await expect.element(dialog).not.toBeInTheDocument();
    }
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.update" }),
    );
  } finally {
    await owner.close();
  }
});

for (const code of ["project_conflict", "project_reserved", "project_trust_required"] as const) {
  test(`${code} leaves the Project edit draft with a localized alert`, async () => {
    const owner = ownProjectBrowserTest();
    await page.viewport(1280, 900);
    const connection = await owner.startWire();
    const screen = await owner.render(
      <App
        locale="en"
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      />,
    );
    try {
      const dialog = await openEditor(screen);
      await dialog.getByRole("textbox").fill("My renamed project");
      await fetch(`http://127.0.0.1:${connection.port}/error`, {
        method: "POST",
        body: JSON.stringify({ type: "project.update", code, params: { project: "Other repo" } }),
      });
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect.element(dialog.getByRole("alert")).toHaveTextContent(
        {
          project_conflict: "This folder already belongs to Other repo.",
          project_reserved: "Application data folders cannot be added as a Project.",
          project_trust_required: "Confirm trust for the newly added folders before saving.",
        }[code],
      );
      await expect.element(dialog.getByRole("textbox")).toHaveValue("My renamed project");
      await expect.element(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    } finally {
      await owner.close();
    }
  });
}

test("removal confirmation cancels back to its draft and deletes bound chats, pins and archived history", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await changeProjects(
      connection.port,
      [project],
      [
        session,
        { ...session, id: "two", title: "Second folder history", cwd: "/second" },
        { ...session, id: "archived", title: "Archived history" },
      ],
      ["one"],
      ["archived"],
    );
    let dialog = await openEditor(screen);
    await dialog.getByRole("textbox").fill("Unsaved name");
    for (const action of ["Cancel", "Close", "Escape"]) {
      await dialog.getByRole("button", { name: "Remove local project", exact: true }).click();
      const confirmation = screen.getByRole("dialog", { name: "Remove Project?", exact: true });
      await expect
        .element(confirmation.getByRole("button", { name: "Cancel", exact: true }))
        .toHaveFocus();
      await expect
        .element(
          confirmation.getByText(
            "Delete this project and all of its chats? Files in the project directories will not be deleted.",
            { exact: true },
          ),
        )
        .toBeVisible();
      await expect
        .element(confirmation.getByRole("button", { name: "Remove project", exact: true }))
        .toHaveClass("f01-destructive");
      if (action === "Escape") {
        await confirmation.getByRole("heading", { name: "Remove Project?", exact: true }).click();
        await userEvent.keyboard("{Escape}");
      } else await confirmation.getByRole("button", { name: action, exact: true }).click();
      dialog = screen.getByRole("dialog", { name: "Edit project", exact: true });
      await expect.element(dialog.getByRole("textbox")).toHaveValue("Unsaved name");
    }
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.remove" }),
    );
    await dialog.getByRole("button", { name: "Remove local project", exact: true }).click();
    await screen.getByRole("button", { name: "Remove project", exact: true }).click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await expect
      .element(
        screen
          .getByRole("region", { name: "Projects", exact: true })
          .getByRole("button", { name: "Project", exact: true }),
      )
      .not.toBeInTheDocument();
    await expect
      .element(
        screen
          .getByRole("region", { name: "Pinned", exact: true })
          .getByRole("button", { name: "Existing history", exact: true }),
      )
      .not.toBeInTheDocument();
    await expect
      .element(
        screen
          .getByRole("region", { name: "Conversations", exact: true })
          .getByRole("button", { name: "Second folder history", exact: true }),
      )
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Search chats", exact: true }).click();
    await screen.getByRole("combobox").fill("Archived history");
    await expect
      .element(screen.getByRole("option", { name: "Archived history", exact: true }))
      .not.toBeInTheDocument();
    expect(
      (await requests(connection.port)).filter((request) => request.type === "project.remove"),
    ).toHaveLength(1);
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "session.delete" }),
    );
  } finally {
    await owner.close();
  }
});

test.each(["running", "waitingInteraction"] as const)(
  "a Project with a %s Session cannot be removed",
  async (busy) => {
    const owner = ownProjectBrowserTest();
    await page.viewport(1280, 900);
    const connection = await owner.startWire();
    const screen = await owner.render(
      <App
        locale="en"
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      />,
    );
    try {
      await expect
        .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
        .toBeVisible();
      await changeProjects(connection.port, [project], [{ ...session, [busy]: true }]);
      const dialog = await openEditor(screen);
      const remove = dialog.getByRole("button", { name: "Remove local project", exact: true });
      await expect.element(remove).toBeDisabled();
      await expect
        .element(remove)
        .toHaveAccessibleDescription(
          "A Session in this Project is running, waiting for interaction or open elsewhere. Close or finish it before removing the Project.",
        );
      expect(getComputedStyle(remove.element()).cursor).toBe("not-allowed");
      remove.element().focus();
      await userEvent.keyboard("{Enter}");
      expect(await requests(connection.port)).not.toContainEqual(
        expect.objectContaining({ type: "project.remove" }),
      );
    } finally {
      await owner.close();
    }
  },
);

test("a server busy removal keeps its confirmation open with a localized alert", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    const dialog = await openEditor(screen);
    await dialog.getByRole("button", { name: "Remove local project", exact: true }).click();
    const confirmation = screen.getByRole("dialog", { name: "Remove Project?", exact: true });
    await fetch(`http://127.0.0.1:${connection.port}/error`, {
      method: "POST",
      body: JSON.stringify({ type: "project.remove", code: "session_busy" }),
    });
    await confirmation.getByRole("button", { name: "Remove project", exact: true }).click();
    await expect
      .element(confirmation.getByRole("alert"))
      .toHaveTextContent(
        "A Session in this Project is running, waiting for interaction or open elsewhere. Close or finish it before removing the Project.",
      );
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(dialog.getByRole("textbox")).toHaveValue("Project");
  } finally {
    await owner.close();
  }
});

test("a removed Project clears its opened Session and Transcript", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Project", exact: true }))
      .toBeVisible();
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify({
        type: "snapshot",
        sessionId: "one",
        messages: [{ role: "user", content: "Retained transcript", timestamp: 1 }],
        compactions: [],
        model: "test/script",
      }),
    });
    await expect.element(screen.getByText("Retained transcript", { exact: true })).toBeVisible();
    const projectRow = screen
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name: "Project", exact: true });
    (projectRow.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await screen.getByRole("button", { name: "Edit project", exact: true }).click();
    const editor = screen.getByRole("dialog", { name: "Edit project", exact: true });
    await editor.getByRole("button", { name: "Remove local project", exact: true }).click();
    await screen.getByRole("button", { name: "Remove project", exact: true }).click();
    await expect
      .element(screen.getByText("Retained transcript", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .not.toBeInTheDocument();
  } finally {
    await owner.close();
  }
});

test.each([
  { width: 1280, dark: false },
  { width: 420, dark: true },
])(
  "Project editing and removal retain shell geometry and long names at $width (dark=$dark)",
  async ({ width, dark }) => {
    const owner = ownProjectBrowserTest();
    await page.viewport(width, 700);
    await commands.reducedMotion(true);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.setProperty("--ui-font-size", "18px");
    document.documentElement.classList.toggle("light", !dark);
    const connection = await owner.startWire();
    const name = "repository-with-a-very-long-name-".repeat(4);
    const directories = Array.from(
      { length: 24 },
      (_, i) => `/long/path/${"parent/".repeat(12)}repository-${i}`,
    );
    const screen = await owner.render(
      <App
        locale={dark ? "zh" : "en"}
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      />,
    );
    try {
      await changeProjects(
        connection.port,
        [{ ...project, name, directories, primary: directories[0]! }],
        [],
      );
      const shell = [
        ...document.querySelectorAll<HTMLElement>(".app-titlebar, .app-workspace, main"),
      ];
      const baseline = shell.map((element) => element.getBoundingClientRect());
      let dialog = await openEditor(screen, name, dark);
      expect(dialog.element().getBoundingClientRect().width).toBe(Math.min(520, width - 32));
      expect(getComputedStyle(dialog.element().firstElementChild!).paddingLeft).toBe(
        width === 420 ? "16px" : "24px",
      );
      const list = dialog
        .element()
        .querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
      expect(list.clientHeight).toBeLessThanOrEqual(240);
      expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
      const save = dialog.getByRole("button", { name: dark ? "保存" : "Save", exact: true });
      const remove = dialog.getByRole("button", {
        name: dark ? "移除本地项目" : "Remove local project",
        exact: true,
      });
      expect(save.element().getBoundingClientRect().height).toBe(36);
      expect(remove.element().getBoundingClientRect().height).toBe(32);
      const footerTop = save.element().getBoundingClientRect().top;
      list.scrollTop = list.scrollHeight;
      expect(save.element().getBoundingClientRect().top).toBe(footerTop);
      await remove.click();
      const title = dark ? `移除 ${name}？` : `Remove ${name}?`;
      dialog = screen.getByRole("dialog", { name: title, exact: true });
      expect(dialog.element().getBoundingClientRect().width).toBe(Math.min(448, width - 32));
      await expect.element(dialog.getByRole("heading", { name: title, exact: true })).toBeVisible();
      const close = dialog.getByRole("button", { name: dark ? "关闭" : "Close", exact: true });
      const box = dialog.element().getBoundingClientRect();
      const closeBox = close.element().getBoundingClientRect();
      expect(closeBox.width).toBe(24);
      expect(closeBox.right).toBeLessThanOrEqual(box.right - (dark ? 16 : 24));
      expect(closeBox.left).toBeGreaterThanOrEqual(box.left);
      const heading = dialog.getByRole("heading").element();
      expect(getComputedStyle(heading).whiteSpace).toBe("nowrap");
      expect(heading.getBoundingClientRect().right).toBeLessThanOrEqual(closeBox.left - 8);
      expect(heading.scrollWidth).toBeGreaterThan(heading.clientWidth);
      const confirm = dialog.getByRole("button", {
        name: dark ? "移除项目" : "Remove project",
        exact: true,
      });
      expect(confirm.element().getBoundingClientRect().height).toBe(36);
      expect(getComputedStyle(confirm.element()).backgroundColor).toBe(
        dark ? "rgba(255, 92, 92, 0.15)" : "rgb(253, 232, 232)",
      );
      expect(buttonContrast(confirm.element())).toBeGreaterThanOrEqual(4.5);
      expect(getComputedStyle(confirm.element()).color).toBe(
        dark ? "rgb(255, 149, 149)" : "rgb(207, 34, 46)",
      );
      expect(getComputedStyle(confirm.element()).cursor).toBe("pointer");
      await confirm.hover();
      await expect.poll(() => buttonContrast(confirm.element())).toBeGreaterThanOrEqual(4.5);
      await userEvent.keyboard("{Tab}");
      await expect.element(confirm).toHaveFocus();
      await expect
        .poll(() => {
          const style = getComputedStyle(confirm.element());
          return (
            style.boxShadow !== "none" ||
            (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0)
          );
        })
        .toBe(true);
      await fetch(`http://127.0.0.1:${connection.port}/hold`, { method: "POST" });
      await confirm.click();
      await expect.element(confirm).toBeDisabled();
      expect(getComputedStyle(confirm.element()).cursor).toBe("not-allowed");
      await userEvent.keyboard("{Enter}");
      expect(
        (await requests(connection.port)).filter((request) => request.type === "project.remove"),
      ).toHaveLength(1);
      await expect.element(close).toBeDisabled();
      await expect
        .element(dialog.getByRole("button", { name: dark ? "取消" : "Cancel", exact: true }))
        .toBeDisabled();
      await userEvent.keyboard("{Escape}");
      await expect.element(dialog).toBeVisible();
      await fetch(`http://127.0.0.1:${connection.port}/flush`, { method: "POST" });
      await expect.element(dialog).not.toBeInTheDocument();
      for (const [i, element] of shell.entries())
        for (const key of ["x", "y", "width", "height"] as const)
          expect(
            Math.abs(element.getBoundingClientRect()[key] - baseline[i]![key]),
          ).toBeLessThanOrEqual(1);
    } finally {
      await owner.close();
    }
  },
);

test("canonical Project edits retain alias Session membership, title, count and selection", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    const aliasSession = { ...session, cwd: "/alias", projectId: "project", worktree: null };
    await changeProjects(
      connection.port,
      [{ ...project, directories: ["/canonical"], primary: "/canonical", name: "Renamed" }],
      [aliasSession],
    );
    const group = screen.getByRole("group", { name: "Renamed", exact: true });
    await expect
      .element(group.getByRole("button", { name: "Existing history", exact: true }))
      .toBeVisible();
    const disclosure = group.getByRole("button", { name: "Renamed", exact: true });
    const unselectedBackground = getComputedStyle(
      disclosure.element().parentElement!,
    ).backgroundColor;
    await group.getByRole("button", { name: "Existing history", exact: true }).click();
    const header = screen.getByRole("banner");
    await expect.element(header.getByRole("img", { name: "Renamed", exact: true })).toBeVisible();
    await screen.getByRole("textbox", { name: "Prompt", exact: true }).hover();
    expect(getComputedStyle(disclosure.element().parentElement!).backgroundColor).not.toBe(
      unselectedBackground,
    );
    disclosure.element().focus();
    const card = screen.getByRole("dialog", { name: "Project details", exact: true });
    await expect.element(card.getByText("Sessions: 1", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await screen.getByRole("button", { name: "Search chats", exact: true }).click();
    await expect
      .element(screen.getByRole("option", { name: /Existing history/ }))
      .toHaveTextContent("Existing historyRenamed");
    await userEvent.keyboard("{Escape}");
    await changeProjects(connection.port, [], [{ ...aliasSession, projectId: null }]);
    await expect
      .element(header.getByRole("img", { name: "Renamed", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Existing history", exact: true }))
      .toHaveAttribute("aria-current", "page");
  } finally {
    await owner.close();
  }
});
