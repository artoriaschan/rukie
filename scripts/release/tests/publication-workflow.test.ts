import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { releaseObject } from "../publication.ts";

const root = resolve(import.meta.dir, "../../..");
test("tag and same-tag manual publication serialize exact artifacts across least-privilege stages", async () => {
  const source = await readFile(resolve(root, ".github/workflows/release-publish.yml"), "utf8");
  const workflow = releaseObject(Bun.YAML.parse(source));
  expect(workflow).toMatchObject({
    on: {
      push: { tags: ["coding-agent-v*"] },
      workflow_dispatch: { inputs: { tag: { required: true, type: "string" } } },
    },
    permissions: { contents: "read" },
    concurrency: { group: "npm-publication", "cancel-in-progress": false },
  });
  const jobs = releaseObject(workflow.jobs);
  expect(jobs.verify).toMatchObject({
    needs: "resolve",
    permissions: { contents: "read", actions: "read" },
  });
  expect(jobs.preserve).toMatchObject({
    needs: ["resolve", "verify"],
    permissions: { contents: "write", actions: "read" },
  });
  expect(jobs.publish).toMatchObject({
    needs: ["resolve", "verify", "preserve"],
    permissions: { contents: "read", actions: "read", "id-token": "write" },
  });
  for (const [name, job] of Object.entries(jobs)) {
    const steps = releaseObject(job).steps;
    if (!Array.isArray(steps)) throw new Error("Missing job steps");
    const commands = steps
      .map((value) => releaseObject(value).run)
      .filter((value) => typeof value === "string");
    for (const value of steps) {
      const step = releaseObject(value);
      if (typeof step.uses === "string") expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      if (
        name !== "resolve" &&
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/checkout@")
      )
        expect(step.with).toMatchObject({
          ref: "${{ needs.resolve.outputs.commit }}",
          "persist-credentials": false,
        });
    }
    if (name !== "verify") expect(commands.join("\n")).not.toMatch(/release:build|npm pack/);
    if (name === "resolve")
      expect(commands.join("\n")).toContain('test "$GITHUB_REF" = "refs/tags/$RELEASE_TAG"');
    if (name === "verify") {
      expect(commands.filter((value) => value.includes("release:build"))).toHaveLength(1);
      expect(commands.join("\n")).toContain("--require-unpublished");
      expect(commands.join("\n")).toContain(
        'env -u NO_COLOR bun run check > "$RUNNER_TEMP/rukie-check.log" 2>&1',
      );
      expect(commands.join("\n")).toContain("current-acceptance.json");
      const upload = steps
        .map(releaseObject)
        .find(
          (step) =>
            typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact@"),
        );
      expect(releaseObject(upload?.with).path).toContain("/release-modules.json");
    }
  }
  expect(source).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
});
