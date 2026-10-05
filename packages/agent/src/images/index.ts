/** Base64 image supplied by a frontend; names are Transcript metadata only. */
export interface PromptImage {
  data: string;
  mimeType: string;
  name?: string;
}

export interface ImageInfo {
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  width: number;
  height: number;
}

export type ImageValidationCode =
  | "image-invalid"
  | "image-too-large"
  | "image-dimensions"
  | "image-mime-mismatch";

/** Structured reasons let frontends localize failures without parsing English text. */
export class ImageValidationError extends Error {
  constructor(
    message: string,
    readonly code: ImageValidationCode,
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "ImageValidationError";
  }
}

/**
 * Match pi read's PNG/JPEG/GIF/WebP admission independently of dimension parsing.
 * APNG and JPEG-LS stay on pi's text path; BMP stays on its processor-omission path.
 */
export function detectReadImageMimeType(data: Uint8Array): ImageInfo["mimeType"] | undefined {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return bytes[3] === 0xf7 ? undefined : "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("latin1", 0, 6))) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (
    bytes.length < 16 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("latin1", 12, 16) !== "IHDR"
  )
    return undefined;
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const chunk = bytes.toString("latin1", offset + 4, offset + 8);
    if (chunk === "acTL") return undefined;
    if (chunk === "IDAT") break;
    const next = offset + 12 + bytes.readUInt32BE(offset);
    if (next > bytes.length) break;
    offset = next;
  }
  return "image/png";
}

/** Header metadata only; no image decoding, resizing, or size-limit enforcement. */
export function inspectImage(data: Uint8Array): ImageInfo | undefined {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  )
    return { mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)))
    return { mimeType: "image/gif", width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (
    bytes.length >= 20 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    const end = bytes.readUInt32LE(4) + 8;
    if (end > bytes.length) return undefined;
    for (let offset = 12; offset + 8 <= end;) {
      const chunk = bytes.toString("ascii", offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + length > end) return undefined;
      if (chunk === "VP8X" && length >= 10)
        return {
          mimeType: "image/webp",
          width: bytes.readUIntLE(start + 4, 3) + 1,
          height: bytes.readUIntLE(start + 7, 3) + 1,
        };
      if (chunk === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
        const dimensions = bytes.readUInt32LE(start + 1);
        return {
          mimeType: "image/webp",
          width: (dimensions & 0x3fff) + 1,
          height: ((dimensions >>> 14) & 0x3fff) + 1,
        };
      }
      if (
        chunk === "VP8 " &&
        length >= 10 &&
        bytes.toString("hex", start + 3, start + 6) === "9d012a"
      )
        return {
          mimeType: "image/webp",
          width: bytes.readUInt16LE(start + 6) & 0x3fff,
          height: bytes.readUInt16LE(start + 8) & 0x3fff,
        };
      offset = start + length + (length % 2);
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) return undefined;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) return undefined;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return undefined;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return undefined;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) return undefined;
        return {
          mimeType: "image/jpeg",
          width: bytes.readUInt16BE(offset + 5),
          height: bytes.readUInt16BE(offset + 3),
        };
      }
      offset += length;
    }
  }
  return undefined;
}

/** Validate the original bytes once for read, Session, and frontend attachment staging. */
export function validateImageBytes(data: Uint8Array): ImageInfo {
  if (data.byteLength > 5 * 1024 * 1024)
    throw new ImageValidationError("Image exceeds the 5 MB limit.", "image-too-large", {
      maxBytes: 5 * 1024 * 1024,
    });
  const info = inspectImage(data);
  if (!info || !info.width || !info.height)
    throw new ImageValidationError(
      "Invalid or unsupported image; use PNG, JPEG, WebP, or GIF.",
      "image-invalid",
    );
  if (info.width > 8000 || info.height > 8000)
    throw new ImageValidationError(
      "Image dimensions exceed the 8000 px limit.",
      "image-dimensions",
      { width: info.width, height: info.height, maxPixels: 8000 },
    );
  return info;
}

/** Reject malformed base64 and MIME claims that disagree with the file header. */
export function validateImage(image: Pick<PromptImage, "data" | "mimeType">): ImageInfo {
  if (
    !image.data ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)
  )
    throw new ImageValidationError("Invalid image base64 data.", "image-invalid");
  const info = validateImageBytes(Buffer.from(image.data, "base64"));
  if (image.mimeType !== info.mimeType)
    throw new ImageValidationError(
      "Image MIME type does not match its file header.",
      "image-mime-mismatch",
      { mimeType: info.mimeType },
    );
  return info;
}

declare module "@earendil-works/pi-ai" {
  interface UserMessage {
    /** Names in image-block order; null means no name. Stripped at the model boundary. */
    imageNames?: Array<string | null>;
  }
}
