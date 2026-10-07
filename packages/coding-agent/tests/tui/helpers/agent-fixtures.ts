import { join } from "node:path";
import type { SubagentRun } from "@rukie/agent";
import type { FauxResponseStep, TranscriptContext, Model } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";

// These internal fixture contracts are owned by Agent tests. Runtime imports keep
// their implementation outside the frontend workspace's TypeScript project.
export async function crashedSubagents(dirs: { cwd: string; homeDir: string }) {
  const fixture: {
    crashedSubagents(dirs: { cwd: string; homeDir: string }): Promise<{
      parentId: string;
      child(
        description: string,
        outcome?: SubagentRun["outcome"],
      ): Promise<{ metadata: { id: string }; run: SubagentRun; requestId: string }>;
      save(): Promise<void>;
    }>;
  } = await import(join(import.meta.dir, "../../../../agent/tests/helpers/crashed-subagents.ts"));
  return fixture.crashedSubagents(dirs);
}

export async function fakeModel(responses: FauxResponseStep[]) {
  const fixture: {
    fakeModel(responses: FauxResponseStep[]): {
      models: MutableModels;
      model: Model<string>;
      contexts: TranscriptContext[];
    };
  } = await import(join(import.meta.dir, "../../../../agent/tests/helpers/fake-model.ts"));
  return fixture.fakeModel(responses);
}
