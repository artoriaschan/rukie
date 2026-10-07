import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPrivateExports } from "./private-exports";
import type { ClipboardContent } from "./index";

const macClipboard = `ObjC.import('AppKit');
var pb = $.NSPasteboard.generalPasteboard, items = pb.pasteboardItems, paths = [];
if (items) for (var i = 0; i < ObjC.unwrap(items.count); i++) {
var raw = items.objectAtIndex(i).stringForType('public.file-url');
if (raw) { var url = $.NSURL.URLWithString(raw); if (ObjC.unwrap(url.isFileURL)) paths.push(ObjC.unwrap(url.path)); }
}
JSON.stringify({files: paths, types: ObjC.deepUnwrap(pb.types) || []});`;

const macImage = `on run argv
set outputPath to item 1 of argv
set imageFormat to item 2 of argv
if imageFormat is "png" then
set imageData to the clipboard as «class PNGf»
else
set imageData to the clipboard as «class TIFF»
end if
set outputFile to open for access (POSIX file outputPath) with write permission
try
set eof outputFile to 0
write imageData to outputFile
close access outputFile
on error messageText number errorNumber
try
close access outputFile
end try
error messageText number errorNumber
end try
end run`;

const imageTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/tiff",
  "image/bmp",
];
const hasImageExtension = (path: string) => /\.(png|jpe?g|gif|webp)$/i.test(path);
const uriFiles = (value: string) =>
  value.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith("file://")) return [];
    try {
      return [fileURLToPath(line)];
    } catch {
      return [];
    }
  });

/** Per-main clipboard exports outlive staging and are reclaimed after pending reads settle. */
export function createClipboard() {
  const exports = createPrivateExports("rukie-clipboard-");
  const run = async (command: string[]) => {
    if (exports.closed) return;
    try {
      const child = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
      const timeout = setTimeout(() => child.kill(), 3000);
      try {
        const bytes = new Uint8Array(await new Response(child.stdout).arrayBuffer());
        if ((await child.exited) === 0) return bytes;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Missing helpers or stale display connections fall through to another backend.
    }
  };
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const exportImage = async (extension: string, write: (path: string) => Promise<void>) => {
    const path = await exports.write(extension, write);
    return path ? { image: { path } } : ({ unavailable: true } as const);
  };
  const macMetadata = async () => {
    const metadata = await run(["osascript", "-l", "JavaScript", "-e", macClipboard]);
    if (metadata) {
      const value: unknown = JSON.parse(text(metadata));
      if (!value || typeof value !== "object" || !("files" in value) || !("types" in value))
        throw new Error("Invalid clipboard metadata");
      const { files, types } = value;
      if (
        !Array.isArray(files) ||
        !files.every((path) => typeof path === "string") ||
        !Array.isArray(types) ||
        !types.every((type) => typeof type === "string")
      )
        throw new Error("Invalid clipboard metadata");
      return { files, types };
    }
  };
  const readMac = async (): Promise<ClipboardContent> => {
    const metadata = await macMetadata();
    let extension: string | undefined;
    if (metadata) {
      const { files, types } = metadata;
      if (files.length) return { files };
      // AppleScript clipboard info includes convertible formats; inspect native types to avoid conversion.
      extension = types.includes("public.png")
        ? "png"
        : types.includes("public.tiff")
          ? "tiff"
          : undefined;
    } else {
      const file = await run(["osascript", "-e", "POSIX path of (the clipboard as «class furl»)"]);
      if (file) return { files: [text(file).replace(/\r?\n$/, "")] };
    }
    if (extension)
      return exportImage(extension, async (path) => {
        const written = await run(["osascript", "-e", macImage, path, extension]);
        if (!written) throw new Error("Could not export clipboard image");
      });
    const value = await run(["pbpaste"]);
    return value ? (value.length ? { text: text(value) } : { empty: true }) : { unavailable: true };
  };
  const linuxRead = (backend: "wayland" | "x11", type: string) =>
    run(
      backend === "wayland"
        ? ["wl-paste", "--no-newline", "--type", type]
        : ["xclip", "-selection", "clipboard", "-o", "-t", type],
    );
  const linuxTypes = async (backend: "wayland" | "x11") => {
    const advertised = await run(
      backend === "wayland"
        ? ["wl-paste", "--list-types"]
        : ["xclip", "-selection", "clipboard", "-o", "-t", "TARGETS"],
    );
    return (
      advertised &&
      text(advertised)
        .split(/\r?\n/)
        .map((type) => type.trim())
    );
  };
  const readLinux = async (): Promise<ClipboardContent> => {
    for (const backend of ["wayland", "x11"] as const) {
      const types = await linuxTypes(backend);
      if (!types) continue;
      const read = (type: string) => linuxRead(backend, type);
      if (types.includes("text/uri-list")) {
        const uris = await read("text/uri-list");
        if (!uris) continue;
        const files = uriFiles(text(uris));
        if (files.length) return { files };
      }
      const imageType = imageTypes.find((type) => types.includes(type));
      if (imageType) {
        const bytes = await read(imageType);
        if (!bytes) continue;
        return exportImage(imageType.slice(6), (path) => writeFile(path, bytes));
      }
      const textType = ["text/plain;charset=utf-8", "UTF8_STRING", "text/plain", "STRING"].find(
        (type) => types.includes(type),
      );
      if (textType) {
        const value = await read(textType);
        if (!value) continue;
        return value.length ? { text: text(value) } : { empty: true };
      }
      if (!types.some(Boolean)) return { empty: true };
    }
    const value = await run(["xsel", "--clipboard", "--output"]);
    return value ? (value.length ? { text: text(value) } : { empty: true }) : { unavailable: true };
  };
  const hasImage = async () => {
    if (process.platform === "darwin") {
      const metadata = await macMetadata();
      if (!metadata) return false;
      return metadata.files.length
        ? metadata.files.some(hasImageExtension)
        : metadata.types.includes("public.png") || metadata.types.includes("public.tiff");
    }
    if (process.platform === "win32") return false;
    for (const backend of ["wayland", "x11"] as const) {
      const types = await linuxTypes(backend);
      if (!types) continue;
      if (types.includes("text/uri-list")) {
        const uris = await linuxRead(backend, "text/uri-list");
        const files = uris && uriFiles(text(uris));
        if (files?.length) return files.some(hasImageExtension);
      }
      return imageTypes.some((type) => types.includes(type));
    }
    return false;
  };
  return {
    hasImage(): Promise<boolean> {
      return exports.closed ? Promise.resolve(false) : exports.track(hasImage());
    },
    read(): Promise<ClipboardContent> {
      if (exports.closed) return Promise.resolve({ unavailable: true });
      const operation =
        process.platform === "darwin"
          ? readMac()
          : process.platform === "win32"
            ? run(["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw"]).then(
                (value): ClipboardContent =>
                  value
                    ? value.length
                      ? { text: text(value) }
                      : { empty: true }
                    : { unavailable: true },
              )
            : readLinux();
      return exports.track(operation);
    },
    dispose: exports.dispose,
  };
}
