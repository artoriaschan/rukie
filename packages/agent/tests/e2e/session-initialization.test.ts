import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("aborting initialization after opening does not cancel an accepted native Run", async () => {
  const dirs = await tempDirs();
  const initialization = new AbortController();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      started.resolve();
      await release.promise;
      return fauxAssistantMessage("accepted work completed");
    },
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    initializationSignal: initialization.signal,
  });
  try {
    const running = session.run("accepted work");
    await started.promise;
    initialization.abort();
    release.resolve();
    expect((await running).text).toBe("accepted work completed");
    expect(fake.contexts).toHaveLength(1);
  } finally {
    release.resolve();
    await session.close();
    await dirs.cleanup();
  }
});
