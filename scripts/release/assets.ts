import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { releaseBytes, releaseObject, verifyPublicationArtifacts } from "./publication.ts";
import { releaseVersion } from "./tag.ts";

export type ReleaseAssetContext = {
  repository: string;
  tag: string;
  commit: string;
  token: string;
  api?: string;
  runId?: string;
  runAttempt?: string;
};
const verificationJob = "Verify source and installed darwin-arm64";
function client(context: ReleaseAssetContext) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(context.repository) || !/^[a-f0-9]{40}$/.test(context.commit))
    throw new Error("Invalid release asset identity");
  releaseVersion(context.tag);
  const api = context.api ?? "https://api.github.com";
  const endpoint = new URL(api);
  const local = endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1";
  if (
    (!local && endpoint.origin !== "https://api.github.com") ||
    endpoint.pathname !== "/" ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error("Untrusted GitHub API origin");
  async function request(path: string, options: RequestInit = {}) {
    return fetch(`${api.replace(/\/$/, "")}/repos/${context.repository}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${context.token}`,
        accept: "application/vnd.github+json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  }
  return { local, request };
}
function files(tag: string) {
  const version = releaseVersion(tag);
  return [
    `rukie-coding-agent-${version}.tgz`,
    `rukie-coding-agent-darwin-arm64-${version}.tgz`,
    "release-build.json",
    "ci-acceptance.json",
  ];
}
async function release(context: ReleaseAssetContext) {
  const { request } = client(context);
  const response = await request(`/releases/tags/${context.tag}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub Release lookup failed (${response.status})`);
  const value = releaseObject(await response.json());
  if (
    value.tag_name !== context.tag ||
    !Number.isSafeInteger(value.id) ||
    !Array.isArray(value.assets)
  )
    throw new Error("GitHub Release identity is invalid");
  return value;
}

/** A witness is trusted only after the exact run attempt's read-only job is externally confirmed. */
export async function verifyAcceptanceWitness(
  context: ReleaseAssetContext,
  directory: string,
  filename = "ci-acceptance.json",
  current = false,
) {
  const { local, request } = client(context);
  const metadata = await verifyPublicationArtifacts(
    directory,
    local ? undefined : context.commit,
    local ? undefined : context.repository,
    !local,
  );
  if (metadata.commit !== context.commit || metadata.version !== releaseVersion(context.tag))
    throw new Error("Release assets do not belong to the selected tag");
  const audit = releaseObject(await Bun.file(join(directory, filename)).json());
  const metadataHash = createHash("sha256")
    .update(await readFile(join(directory, "release-build.json")))
    .digest("hex");
  if (
    audit.schemaVersion !== 1 ||
    audit.commit !== context.commit ||
    audit.repository !== context.repository ||
    audit.platform !== metadata.platform ||
    audit.releaseBuildSha256 !== metadataHash ||
    JSON.stringify(audit.packages) !== JSON.stringify(metadata.packages) ||
    typeof audit.runId !== "string" ||
    !/^[1-9]\d*$/.test(audit.runId) ||
    typeof audit.runAttempt !== "string" ||
    !/^[1-9]\d*$/.test(audit.runAttempt) ||
    !["push", "workflow_dispatch"].includes(String(audit.event))
  )
    throw new Error("Release acceptance witness identity mismatch");
  if (current && (audit.runId !== context.runId || audit.runAttempt !== context.runAttempt))
    throw new Error("Current acceptance witness belongs to a different run attempt");
  const runResponse = await request(`/actions/runs/${audit.runId}/attempts/${audit.runAttempt}`);
  if (!runResponse.ok) throw new Error("Cannot confirm acceptance run identity");
  const run = releaseObject(await runResponse.json());
  if (
    run.head_sha !== context.commit ||
    releaseObject(run.repository).full_name !== context.repository ||
    run.path !== ".github/workflows/release-publish.yml" ||
    run.event !== audit.event ||
    String(run.id) !== audit.runId ||
    String(run.run_attempt) !== audit.runAttempt
  )
    throw new Error("GitHub acceptance run identity mismatch");
  const jobsResponse = await request(
    `/actions/runs/${audit.runId}/attempts/${audit.runAttempt}/jobs?per_page=100`,
  );
  if (!jobsResponse.ok) throw new Error("Cannot confirm acceptance job");
  const jobs = releaseObject(await jobsResponse.json()).jobs;
  if (
    !Array.isArray(jobs) ||
    !jobs.some((value) => {
      const job = releaseObject(value);
      return (
        job.name === verificationJob &&
        job.head_sha === context.commit &&
        job.status === "completed" &&
        job.conclusion === "success"
      );
    })
  )
    throw new Error("Exact read-only acceptance job has not succeeded");
  return metadata;
}

async function downloadAsset(context: ReleaseAssetContext, id: unknown) {
  if (!Number.isSafeInteger(id) || Number(id) <= 0) throw new Error("Invalid release asset ID");
  const { request, local } = client(context);
  let response = await request(`/releases/assets/${id}`, {
    headers: { accept: "application/octet-stream" },
    redirect: "manual",
  });
  if (response.status === 302) {
    const redirect = new URL(response.headers.get("location") ?? "");
    if (
      local ||
      redirect.protocol !== "https:" ||
      !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(
        redirect.hostname,
      )
    )
      throw new Error("Untrusted release asset redirect");
    response = await fetch(redirect, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  }
  if (!response.ok) throw new Error("Release asset download failed");
  return releaseBytes(response);
}

/** Missing original set permits the first build; any partial set blocks reconstruction. */
export async function downloadOriginalAssets(context: ReleaseAssetContext, directory: string) {
  const value = await release(context);
  if (!value) return false;
  const expected = files(context.tag);
  const assets = value.assets;
  if (!Array.isArray(assets)) throw new Error("Invalid assets");
  const selected = assets
    .map(releaseObject)
    .filter((asset) => expected.includes(String(asset.name)));
  if (!selected.length) {
    if (value.immutable === true)
      throw new Error(
        "Immutable Release cannot receive original artifacts; disable immutable Releases before creating release tags",
      );
    return false;
  }
  if (
    selected.length !== expected.length ||
    new Set(selected.map((asset) => asset.name)).size !== expected.length
  )
    throw new Error(
      "Partial original Release assets; restore the accepted originals, never rebuild after partial publication",
    );
  if (
    selected.some(
      (asset) =>
        asset.state !== "uploaded" || !Number.isSafeInteger(asset.size) || Number(asset.size) <= 0,
    )
  )
    throw new Error("Original Release asset upload is incomplete");
  await mkdir(directory, { recursive: true });
  for (const asset of selected) {
    const bytes = await downloadAsset(context, asset.id);
    if (bytes.length !== asset.size) throw new Error("Original Release asset size mismatch");
    await Bun.write(join(directory, String(asset.name)), bytes);
  }
  await verifyAcceptanceWitness(context, directory);
  return true;
}

/** Persist accepted original bytes before any npm write; matching complete assets remain untouched. */
export async function preserveOriginalAssets(context: ReleaseAssetContext, directory: string) {
  await verifyAcceptanceWitness(context, directory, "current-acceptance.json", true);
  let value = await release(context);
  const { request, local } = client(context);
  if (!value) {
    const response = await request("/releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tag_name: context.tag,
        target_commitish: context.commit,
        name: context.tag,
        body: "npm publication pending; accepted artifacts are preserved separately.",
      }),
    });
    if (!response.ok) throw new Error("Cannot create GitHub Release for accepted artifacts");
    value = releaseObject(await response.json());
  }
  if (!Number.isSafeInteger(value.id)) throw new Error("Invalid Release ID");
  const scratch = join(directory, "original-assets-check");
  try {
    if (await downloadOriginalAssets(context, scratch)) {
      for (const name of files(context.tag))
        if (
          !Buffer.from(await readFile(join(directory, name))).equals(
            await readFile(join(scratch, name)),
          )
        )
          throw new Error(`Original Release asset conflict: ${name}`);
      return;
    }
    if (value.immutable === true)
      throw new Error("Immutable Release cannot receive accepted artifacts");
    if (typeof value.upload_url !== "string") throw new Error("Missing release upload URL");
    const upload = new URL(value.upload_url.replace(/\{.*$/, ""));
    if (
      (!local && upload.origin !== "https://uploads.github.com") ||
      (local && upload.origin !== new URL(context.api!).origin)
    )
      throw new Error("Untrusted asset upload origin");
    for (const name of files(context.tag)) {
      upload.searchParams.set("name", name);
      const response = await fetch(upload, {
        method: "POST",
        headers: {
          authorization: `Bearer ${context.token}`,
          "content-type": "application/octet-stream",
        },
        body: await readFile(join(directory, name)),
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok)
        throw new Error(
          `Original asset preservation failed (${response.status}); inspect partial state before retrying`,
        );
    }
    if (!(await downloadOriginalAssets(context, scratch)))
      throw new Error("Original artifacts were not preserved");
    for (const name of files(context.tag))
      if (
        !Buffer.from(await readFile(join(directory, name))).equals(
          await readFile(join(scratch, name)),
        )
      )
        throw new Error("Preserved artifact bytes changed");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function verifyOriginalAssetEquality(context: ReleaseAssetContext, directory: string) {
  const scratch = join(directory, "original-assets-check");
  try {
    if (!(await downloadOriginalAssets(context, scratch)))
      throw new Error("Original accepted assets are not preserved");
    for (const name of files(context.tag))
      if (
        !Buffer.from(await readFile(join(directory, name))).equals(
          await readFile(join(scratch, name)),
        )
      )
        throw new Error("Original asset conflict before publication");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function attachPublicationReceipt(context: ReleaseAssetContext, directory: string) {
  await verifyAcceptanceWitness(context, directory, "current-acceptance.json", true);
  const receipt = releaseObject(await Bun.file(join(directory, "publication-result.json")).json());
  if (
    receipt.commit !== context.commit ||
    receipt.version !== releaseVersion(context.tag) ||
    !["latest", "next"].includes(String(receipt.channel))
  )
    throw new Error("Publication receipt identity mismatch");
  const value = await release(context);
  if (
    !value ||
    value.immutable === true ||
    typeof value.upload_url !== "string" ||
    !Array.isArray(value.assets)
  )
    throw new Error("Release cannot receive publication receipt");
  const name = `npm-publication-${context.runId}-${context.runAttempt}.json`;
  const bytes = await readFile(join(directory, "publication-result.json"));
  const existing = value.assets.map(releaseObject).find((asset) => asset.name === name);
  if (existing) {
    if (!bytes.equals(Buffer.from(await downloadAsset(context, existing.id))))
      throw new Error("Publication receipt conflict");
    return;
  }
  const url = new URL(value.upload_url.replace(/\{.*$/, ""));
  const { local } = client(context);
  if (
    (!local && url.origin !== "https://uploads.github.com") ||
    (local && url.origin !== new URL(context.api!).origin)
  )
    throw new Error("Untrusted receipt upload origin");
  url.searchParams.set("name", name);
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${context.token}`, "content-type": "application/json" },
    body: bytes,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      "npm succeeded but receipt attachment failed; retain original artifacts for recovery",
    );
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      mode: { type: "string" },
      tag: { type: "string" },
      commit: { type: "string" },
      "artifact-dir": { type: "string" },
    },
  });
  if (
    !values.tag ||
    !values.commit ||
    !values["artifact-dir"] ||
    !process.env.GITHUB_REPOSITORY ||
    !process.env.GH_TOKEN
  )
    throw new Error("Asset operation requires exact tag, commit, directory and GitHub identity");
  const context = {
    repository: process.env.GITHUB_REPOSITORY,
    tag: values.tag,
    commit: values.commit,
    token: process.env.GH_TOKEN,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  const directory = resolve(values["artifact-dir"]);
  if (values.mode === "download")
    console.log((await downloadOriginalAssets(context, directory)) ? "original" : "new");
  else if (values.mode === "preserve") await preserveOriginalAssets(context, directory);
  else if (values.mode === "verify") {
    await verifyAcceptanceWitness(context, directory, "current-acceptance.json", true);
    const scratch = join(directory, "original-assets-check");
    try {
      if (!(await downloadOriginalAssets(context, scratch)))
        throw new Error("Original accepted assets are not preserved");
      for (const name of files(context.tag))
        if (
          !Buffer.from(await readFile(join(directory, name))).equals(
            await readFile(join(scratch, name)),
          )
        )
          throw new Error("Original asset conflict before publication");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } else if (values.mode === "receipt") await attachPublicationReceipt(context, directory);
  else throw new Error("--mode must be download, preserve, verify or receipt");
}
