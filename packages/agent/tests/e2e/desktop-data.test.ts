import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { utimes } from "node:fs/promises";
import { join } from "node:path";
import { createSession, listSessions, listSkills, type Session } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
  await dirs?.cleanup();
});

test("desktop Session discovers only its own user content and tools retain real home paths", async () => {
  dirs = await tempDirs();
  const dataRoot = join(dirs.homeDir, "desktop-data");
  for (const namespace of [".rukie", ".claude", ".agents"])
    await Bun.write(
      join(dirs.homeDir, namespace, "skills/sentinel/SKILL.md"),
      "---\nname: sentinel\ndescription: terminal sentinel\n---\nterminal sentinel",
    );
  await Bun.write(
    join(dirs.homeDir, ".agents/agents/sentinel.md"),
    "---\nname: sentinel\ndescription: terminal agent sentinel\n---\nsecret",
  );
  await Bun.write(
    join(dataRoot, "agents/desktop-agent.md"),
    "---\nname: desktop-agent\ndescription: desktop agent\n---\nowned agent",
  );
  await Bun.write(join(dirs.homeDir, ".rukie/AGENTS.md"), "terminal rule sentinel");
  await Bun.write(join(dirs.homeDir, ".rukie/mcp.json"), "invalid terminal sentinel");
  await Bun.write(join(dataRoot, "rules/AGENTS.md"), "desktop user instruction");
  await Bun.write(
    join(dataRoot, "skills/desktop-skill/SKILL.md"),
    "---\nname: desktop-skill\ndescription: desktop skill\n---\nowned skill",
  );
  await Bun.write(join(dirs.homeDir, "target.txt"), "real home text");
  const fake = fakeModel([
    (context) => {
      const visible = JSON.stringify(context);
      expect(visible).toContain("desktop user instruction");
      expect(visible).toContain("desktop-skill");
      expect(visible).toContain("desktop-agent");
      expect(visible).not.toContain("terminal agent sentinel");
      expect(visible).not.toContain("terminal rule sentinel");
      expect(visible).not.toContain("terminal sentinel");
      return fauxAssistantMessage(
        fauxToolCall("write", { path: "~/target.txt", content: "changed" }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage("done"),
  ]);
  expect(await listSkills({ ...dirs, dataRoot })).toEqual([
    {
      name: "desktop-skill",
      description: "desktop skill",
      scope: "user",
      filePath: join(dataRoot, "skills/desktop-skill/SKILL.md"),
    },
  ]);
  const warnings: string[] = [];
  session = await createSession({
    ...dirs,
    dataRoot,
    ...fake,
    permissionMode: "full-access",
    onWarning: (warning) => warnings.push(warning),
  });
  await session.run("change home file");
  expect(await Bun.file(join(dirs.homeDir, "target.txt")).text()).toBe("changed");
  expect(session.checkpoints()[0]?.files[0]?.backup).toStartWith(`file-history/${session.id}/`);
  expect(warnings).not.toContainEqual(
    expect.stringContaining(join(dirs.homeDir, ".rukie/mcp.json")),
  );
  expect((await listSessions({ ...dirs, dataRoot })).map((item) => item.id)).toContain(session.id);
  expect(await listSessions(dirs)).toEqual([]);
});

test("desktop permission tilde rules match real home rather than application files", async () => {
  dirs = await tempDirs();
  const dataRoot = join(dirs.homeDir, "desktop-data");
  await Bun.write(join(dirs.homeDir, "target.txt"), "protected home file");
  session = await createSession({
    ...dirs,
    dataRoot,
    permissionMode: "full-access",
    settings: { permissions: { deny: ["write(~/target.txt)"] } },
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "~/target.txt", content: "forbidden" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("denied"),
    ]),
  });
  await session.run("attempt change");
  expect(await Bun.file(join(dirs.homeDir, "target.txt")).text()).toBe("protected home file");
  expect(session.messages.some((message) => message.role === "toolResult" && message.isError)).toBe(
    true,
  );
});

test("desktop startup leaves another Session history to its own execution lease", async () => {
  dirs = await tempDirs();
  const dataRoot = join(dirs.homeDir, "desktop-data");
  const previousHistory = join(dataRoot, "file-history", "previous-session");
  await Bun.write(join(previousHistory, "backup"), "historical branch bytes");
  await utimes(previousHistory, new Date("2000-01-01"), new Date("2000-01-01"));
  session = await createSession({ ...dirs, dataRoot, ...fakeModel([]) });
  expect(await Bun.file(join(previousHistory, "backup")).text()).toBe("historical branch bytes");
});
