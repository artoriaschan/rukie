import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected registry object");
  return Object.fromEntries(Object.entries(value));
}

/** Minimal npm wire fixture: immutable versions and bytes; no upstream registry or real auth. */
async function createRegistry() {
  const packages = new Map<string, Record<string, unknown>>();
  const tarballs = new Map<string, Uint8Array>();
  let failPackage: string | undefined;
  let failTag = false;
  let unknownPackage: string | undefined;
  let unknownTag = false;
  let lookupFailure: number | undefined;
  const uploads: string[] = [];
  let tarballGets = 0;
  let origin = "";
  async function handle(request: Request): Promise<Response> {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (
      request.method !== "GET" &&
      request.headers.get("authorization") !== "Bearer local-fabricated"
    )
      return Response.json({ error: "fixture auth" }, { status: 403 });
    if (request.method === "GET" && lookupFailure !== undefined && !path.endsWith(".tgz")) {
      const status = lookupFailure;
      lookupFailure = undefined;
      return Response.json({ error: "uncertain lookup" }, { status });
    }
    const bytes = tarballs.get(path);
    if (bytes) {
      ++tarballGets;
      return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
    }
    const tags = /^\/-\/package\/(.+)\/dist-tags(?:\/(.+))?$/.exec(path);
    if (tags) {
      const pkg = packages.get(tags[1]!);
      if (!pkg) return Response.json({ error: "not_found" }, { status: 404 });
      if (request.method === "GET") return Response.json(pkg["dist-tags"]);
      if (request.method === "PUT") {
        if (failTag) {
          failTag = false;
          return Response.json({ error: "tag failure" }, { status: 503 });
        }
        const version: unknown = await request.json();
        if (typeof version !== "string" || !object(pkg.versions)[version] || !tags[2])
          return Response.json({ error: "missing version" }, { status: 404 });
        object(pkg["dist-tags"]); // Validate stored state before its mutation.
        pkg["dist-tags"] = { ...object(pkg["dist-tags"]), [tags[2]]: version };
        if (unknownTag) {
          unknownTag = false;
          return new Response(null, { headers: { "x-fixture-disconnect": "true" } });
        }
        return Response.json({ ok: true });
      }
    }
    const name = path.slice(1);
    if (request.method === "PUT") {
      uploads.push(name);
      if (failPackage === name) {
        failPackage = undefined;
        return Response.json({ error: "upload failure" }, { status: 503 });
      }
      const doc = object(await request.json());
      const versions = object(doc.versions);
      const previous = packages.get(name);
      const existing = previous ? object(previous.versions) : {};
      for (const [version, value] of Object.entries(versions)) {
        if (existing[version]) return Response.json({ error: "version exists" }, { status: 409 });
        const dist = object(object(value).dist);
        const attachment = object(Object.values(object(doc._attachments))[0]);
        if (typeof attachment.data !== "string" || typeof dist.tarball !== "string")
          throw new Error("Missing npm tarball");
        const upload = Buffer.from(attachment.data, "base64");
        if (
          upload.length !== attachment.length ||
          `sha512-${createHash("sha512").update(upload).digest("base64")}` !== dist.integrity
        )
          throw new Error("Upload integrity mismatch");
        tarballs.set(decodeURIComponent(new URL(dist.tarball).pathname), upload);
      }
      const { _attachments, ...publicDoc } = doc;
      packages.set(name, {
        ...publicDoc,
        versions: { ...existing, ...versions },
        "dist-tags": {
          ...(previous ? object(previous["dist-tags"]) : {}),
          ...object(doc["dist-tags"]),
        },
      });
      if (unknownPackage === name) {
        unknownPackage = undefined;
        return new Response(null, { headers: { "x-fixture-disconnect": "true" } });
      }
      return Response.json({ ok: true }, { status: 201 });
    }
    if (request.method === "GET") {
      const pkg = packages.get(name);
      return pkg ? Response.json(pkg) : Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json({ error: "unsupported" }, { status: 405 });
  }
  // Real node:http socket closure verifies accepted mutation + lost HTTP response.
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 128 * 1024 * 1024) throw new Error("Fixture request exceeds bound");
        chunks.push(Buffer.from(chunk));
      }
      const response = await handle(
        new Request(origin + incoming.url, {
          method: incoming.method,
          headers: Object.fromEntries(
            Object.entries(incoming.headers).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      if (response.headers.has("x-fixture-disconnect")) {
        incoming.socket.destroy();
        return;
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500);
      outgoing.end(JSON.stringify({ error: "fixture protocol error" }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin + "/",
    uploads,
    get tarballGets() {
      return tarballGets;
    },
    version(name: string, version: string) {
      const pkg = packages.get(name);
      const value = pkg ? object(pkg.versions)[version] : undefined;
      return value ? object(value) : undefined;
    },
    tags(name: string) {
      const pkg = packages.get(name);
      return pkg ? object(pkg["dist-tags"]) : {};
    },
    bytes(name: string, version: string) {
      const pkg = packages.get(name);
      if (!pkg) return undefined;
      const value = object(object(pkg.versions)[version]);
      const url = object(value.dist).tarball;
      if (typeof url !== "string") throw new Error("Missing tarball URL");
      return tarballs.get(decodeURIComponent(new URL(url).pathname));
    },
    failUpload(name: string) {
      failPackage = name;
    },
    failPromotion() {
      failTag = true;
    },
    unknownUpload(name: string) {
      unknownPackage = name;
    },
    unknownPromotion() {
      unknownTag = true;
    },
    failLookup(status: number) {
      lookupFailure = status;
    },
    setTag(name: string, tag: string, version: string) {
      const pkg = packages.get(name);
      if (!pkg || !object(pkg.versions)[version]) throw new Error("Tag target must exist");
      pkg["dist-tags"] = { ...object(pkg["dist-tags"]), [tag]: version };
    },
    mutateVersion(name: string, version: string, update: (value: Record<string, unknown>) => void) {
      const pkg = packages.get(name);
      if (!pkg) throw new Error("Missing package");
      update(object(pkg.versions)[version] as Record<string, unknown>);
    },
    corruptBytes(name: string, version: string) {
      const pkg = packages.get(name);
      if (!pkg) throw new Error("Missing package");
      const url = object(object(object(pkg.versions)[version]).dist).tarball;
      if (typeof url !== "string") throw new Error("Missing blob");
      const bytes = tarballs.get(decodeURIComponent(new URL(url).pathname));
      if (!bytes) throw new Error("Missing bytes");
      bytes[0] = bytes[0]! ^ 1;
    },
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function registryFixture() {
  const registry = await createRegistry();
  const root = await mkdtemp(join(tmpdir(), "rukie registry npm "));
  const home = join(root, "home");
  await mkdir(home);
  const npmrc = join(root, "npmrc");
  const globalrc = join(root, "globalrc");
  await Bun.write(globalrc, "");
  await Bun.write(
    npmrc,
    `registry=${registry.url}\n@rukie:registry=${registry.url}\n//${new URL(registry.url).host}/:_authToken=local-fabricated\n`,
  );
  return {
    registry,
    env: {
      ...process.env,
      HOME: home,
      NPM_CONFIG_USERCONFIG: npmrc,
      NPM_CONFIG_GLOBALCONFIG: globalrc,
      NPM_CONFIG_CACHE: join(root, "cache"),
    },
    cleanup: async () => {
      await registry.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}
