import { createHash } from "node:crypto";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected registry object");
  return Object.fromEntries(Object.entries(value));
}

/** Minimal npm wire fixture: immutable versions and bytes; no upstream registry or real auth. */
export function createRegistry() {
  const packages = new Map<string, Record<string, unknown>>();
  const tarballs = new Map<string, Uint8Array>();
  let failPackage: string | undefined;
  let failTag = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 128 * 1024 * 1024,
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const bytes = tarballs.get(path);
      if (bytes)
        return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
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
          return Response.json({ ok: true });
        }
      }
      const name = path.slice(1);
      if (request.method === "PUT") {
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
        return Response.json({ ok: true }, { status: 201 });
      }
      if (request.method === "GET") {
        const pkg = packages.get(name);
        return pkg ? Response.json(pkg) : Response.json({ error: "not_found" }, { status: 404 });
      }
      return Response.json({ error: "unsupported" }, { status: 405 });
    },
  });
  return {
    url: server.url.origin + "/",
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
    stop: () => server.stop(true),
  };
}
