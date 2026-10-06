import { createHash } from "node:crypto";
import type { HostNode, LayoutNode } from "../layout";

const command = (controls: string, data = "") => `\x1b_G${controls};${data}\x1b\\`;
const MAX_IMAGES = 32;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 32 * 1024 * 1024;

interface Resource {
  id: number;
}

// IDs are shared across renderer mounts, including overlapping injected terminals.
let nextImage = 1;
let nextPlacement = 1;
interface Placement {
  image: number;
  id: number;
  signature: string;
}

/** Owns only images in the current viewport; never retains source bytes after upload. */
export function createGraphics(write: (text: string) => unknown) {
  const resources = new Map<string, Resource>();
  let placements = new Map<HostNode, Placement>();

  function clear() {
    for (const resource of resources.values()) {
      // A broken output stream must not prevent raw-mode and alternate-screen restoration.
      try {
        write(command(`a=d,d=I,i=${resource.id},q=2`));
      } catch {
        /* best-effort deletion */
      }
    }
    resources.clear();
    placements.clear();
  }

  return {
    clear,
    paint(root: LayoutNode, columns: number, rows: number, supported: boolean) {
      const candidates: {
        node: LayoutNode;
        left: number;
        top: number;
        right: number;
        bottom: number;
      }[] = [];
      function visit(
        node: LayoutNode,
        clip: { left: number; top: number; right: number; bottom: number },
      ) {
        const rect = {
          left: Math.max(clip.left, node.x),
          top: Math.max(clip.top, node.y),
          right: Math.min(clip.right, node.x + node.width),
          bottom: Math.min(clip.bottom, node.y + node.height),
        };
        if (rect.left >= rect.right || rect.top >= rect.bottom) return;
        if (node.type === "tui-image") candidates.push({ node, ...rect });
        for (const child of node.children) visit(child, node.type === "tui-scroll" ? rect : clip);
      }
      if (supported) visit(root, { left: 0, top: 0, right: columns, bottom: rows });
      const used = new Set<string>();
      const next = new Map<HostNode, Placement>();
      let bytes = 0;
      let pixels = 0;
      let output = "";
      for (const { node, left, top, right, bottom } of candidates) {
        const { data, mimeType, sourceWidth, sourceHeight, crop } = node.props;
        if (
          !data ||
          mimeType !== "image/png" ||
          !sourceWidth ||
          !sourceHeight ||
          !Number.isSafeInteger(sourceWidth) ||
          !Number.isSafeInteger(sourceHeight) ||
          sourceWidth <= 0 ||
          sourceHeight <= 0 ||
          data.length > (MAX_BYTES * 4) / 3 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
        )
          continue;
        const header = Buffer.from(data.slice(0, 44), "base64");
        if (
          header.length < 24 ||
          header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
          header.subarray(12, 16).toString("ascii") !== "IHDR" ||
          header.readUInt32BE(16) !== sourceWidth ||
          header.readUInt32BE(20) !== sourceHeight
        )
          continue;
        const source = crop ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
        if (
          ![source.x, source.y, source.width, source.height].every(Number.isFinite) ||
          source.width <= 0 ||
          source.height <= 0
        )
          continue;
        const imageBytes =
          (data.length * 3) / 4 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
        const imagePixels = sourceWidth * sourceHeight;
        const key = createHash("sha256")
          .update(data)
          .update(`${sourceWidth}:${sourceHeight}`)
          .digest("hex");
        if (!used.has(key)) {
          if (
            used.size >= MAX_IMAGES ||
            bytes + imageBytes > MAX_BYTES ||
            pixels + imagePixels > MAX_PIXELS
          )
            continue;
          used.add(key);
          bytes += imageBytes;
          pixels += imagePixels;
        }
        let resource = resources.get(key);
        if (!resource) {
          resource = { id: nextImage++ };
          resources.set(key, resource);
          for (let offset = 0; offset < data.length; offset += 4096) {
            const chunk = data.slice(offset, offset + 4096);
            output += command(
              `${offset === 0 ? `a=t,f=100,t=d,i=${resource.id},q=2,` : ""}m=${offset + chunk.length < data.length ? 1 : 0}`,
              chunk,
            );
          }
        }
        const x = Math.max(
          0,
          Math.min(
            sourceWidth - 1,
            Math.floor(source.x + ((left - node.x) * source.width) / node.width),
          ),
        );
        const y = Math.max(
          0,
          Math.min(
            sourceHeight - 1,
            Math.floor(source.y + ((top - node.y) * source.height) / node.height),
          ),
        );
        const width = Math.max(
          1,
          Math.min(sourceWidth - x, Math.ceil(((right - left) * source.width) / node.width)),
        );
        const height = Math.max(
          1,
          Math.min(sourceHeight - y, Math.ceil(((bottom - top) * source.height) / node.height)),
        );
        const signature = `${resource.id}:${left}:${top}:${right}:${bottom}:${x}:${y}:${width}:${height}`;
        const previous = placements.get(node.source);
        const id = previous?.id ?? nextPlacement++;
        if (signature !== previous?.signature) {
          if (previous) output += command(`a=d,d=i,i=${previous.image},p=${id},q=2`);
          output +=
            `\x1b[${top + 1};${left + 1}H` +
            command(
              `a=p,i=${resource.id},p=${id},x=${x},y=${y},w=${width},h=${height},c=${right - left},r=${bottom - top},C=1,q=2`,
            );
        }
        next.set(node.source, { image: resource.id, id, signature });
      }
      for (const [node, placement] of placements) {
        if (!next.has(node))
          output += command(`a=d,d=i,i=${placement.image},p=${placement.id},q=2`);
      }
      for (const [key, resource] of resources) {
        if (!used.has(key)) {
          output += command(`a=d,d=I,i=${resource.id},q=2`);
          resources.delete(key);
        }
      }
      placements = next;
      if (output) write(`\x1b7${output}\x1b8`);
    },
  };
}
