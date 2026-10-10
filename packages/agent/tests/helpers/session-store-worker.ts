import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession, listSessions } from "../../src/index.ts";
import { fakeModel } from "./fake-model.ts";

const [mode, cwd, homeDir, id] = process.argv.slice(2);
if (!cwd || !homeDir) throw new Error("Missing isolated fixture directories");
if (mode === "list") {
  console.log(JSON.stringify(await listSessions({ cwd, homeDir })));
} else {
  const input = Bun.stdin.stream().getReader();
  if (mode === "contend") {
    console.log("WAIT");
    if ((await input.read()).done) throw new Error("Admission barrier closed");
  }
  const fake = fakeModel(mode === "seed" ? [fauxAssistantMessage("Persisted lease fixture")] : []);
  let session;
  try {
    session = await createSession({ cwd, homeDir, ...fake, ...(id ? { resumeId: id } : {}) });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "session-busy")
      throw error;
    console.log("REJECT " + error.message);
    process.exit(0);
  }
  try {
    if (mode === "seed") await session.run("lease-seed");
    console.log(
      "READY " +
        JSON.stringify({
          id: session.id,
          modelCalls: fake.contexts.length,
          messages: session.messages,
        }),
    );
    await input.read();
  } finally {
    await session.close();
    input.releaseLock();
  }
}
