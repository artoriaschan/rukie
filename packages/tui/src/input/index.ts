import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

export interface Key {
  name: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type InputEvent =
  | { type: "key"; input: string; key: Key }
  | { type: "wheel"; input: ""; x: number; y: number; delta: number }
  | { type: "move"; x: number; y: number; button?: number }
  | { type: "mouse"; action: "press" | "release"; button: number; x: number; y: number }
  | { type: "paste"; input: string };

const names: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  "1~": "home",
  "3~": "delete",
  "4~": "end",
  "7~": "home",
  "8~": "end",
  "5~": "pageup",
  "6~": "pagedown",
  "13~": "enter",
  Z: "tab",
  M: "enter",
};

/** Decode a stream, retaining incomplete UTF-8, escape sequences and bracketed paste. */
export function listenInput(
  stdin: Readable,
  emit: (event: InputEvent) => void,
  control?: (sequence: string) => void,
) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let paste: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const key = (name: string, input = "", modifiers = 1) => {
    const flags = modifiers - 1;
    emit({
      type: "key",
      input,
      key: { name, shift: !!(flags & 1), alt: !!(flags & 2), ctrl: !!(flags & 4) },
    });
  };
  function parse() {
    while (buffer) {
      if (paste !== undefined) {
        const end = buffer.indexOf("\x1b[201~");
        if (end < 0) return;
        const input = paste + buffer.slice(0, end);
        buffer = buffer.slice(end + 6);
        paste = undefined;
        emit({ type: "paste", input });
        continue;
      }
      if (buffer.startsWith("\x1b[200~")) {
        buffer = buffer.slice(6);
        paste = "";
        continue;
      }
      if (buffer[0] === "\x1b") {
        if (buffer.length === 1) return;
        if (buffer[1] === "_") {
          const end = buffer.indexOf("\x1b\\", 2);
          if (end < 0) {
            // Bound malformed control strings without exposing their payload as keys.
            if (buffer.length > 4096) buffer = "\x1b_";
            return;
          }
          const sequence = buffer.slice(0, end + 2);
          buffer = buffer.slice(end + 2);
          control?.(sequence);
          continue;
        }
        if (buffer[1] === "[" || buffer[1] === "O") {
          // oxlint-disable-next-line no-control-regex -- ANSI key sequences start with a literal ESC byte
          const sequence = /^\x1b(?:\[|O)([0-?]*)([ -/]*)([@-~])/.exec(buffer);
          if (!sequence) return;
          buffer = buffer.slice(sequence[0].length);
          const [, parameters = "", , final = ""] = sequence;
          if (final === "t") {
            control?.(sequence[0]);
            continue;
          }
          if (parameters.startsWith("<")) {
            const [button, column, row] = parameters.slice(1).split(";").map(Number);
            if (
              final === "M" &&
              (button === 64 || button === 65) &&
              column !== undefined &&
              row !== undefined
            ) {
              emit({
                type: "wheel",
                input: "",
                x: column - 1,
                y: row - 1,
                delta: button === 64 ? -1 : 1,
              });
            } else if (
              final === "M" &&
              button !== undefined &&
              (button & 0x20) !== 0 &&
              (button & 0xc0) === 0 &&
              column !== undefined &&
              row !== undefined
            ) {
              emit({
                type: "move",
                x: column - 1,
                y: row - 1,
                ...((button & 3) < 3 ? { button: button & 3 } : {}),
              });
            } else if (
              (final === "M" || final === "m") &&
              button !== undefined &&
              (button & 0xe0) === 0 &&
              (button & 3) < 3 &&
              column !== undefined &&
              column > 0 &&
              row !== undefined &&
              row > 0
            ) {
              emit({
                type: "mouse",
                action: final === "M" ? "press" : "release",
                button: button & 3,
                x: column - 1,
                y: row - 1,
              });
            }
            continue;
          }
          if (!/^[0-9;]*$/.test(parameters)) continue;
          const [code = 1, modifiers = 1] = parameters.split(";").map(Number);
          if (final === "u" || (final === "~" && code === 27)) {
            const point = code === 27 ? Number(parameters.split(";")[2]) : code;
            const special: Record<number, string> = {
              9: "tab",
              13: "enter",
              27: "escape",
              127: "backspace",
            };
            if (special[point]) key(special[point], "", modifiers);
            else if (point > 0 && point <= 0x10ffff) {
              const input = String.fromCodePoint(point);
              key(input, input, modifiers);
            }
          } else {
            const name = names[final === "~" ? `${code}~` : final];
            if (name) key(name, "", final === "Z" ? 2 : modifiers);
          }
          continue;
        }
        buffer = buffer.slice(1);
        const input = String.fromCodePoint(buffer.codePointAt(0)!);
        buffer = buffer.slice(input.length);
        key(input, input, 3);
        continue;
      }
      const input = String.fromCodePoint(buffer.codePointAt(0)!);
      buffer = buffer.slice(input.length);
      const point = input.codePointAt(0)!;
      if (input === "\r" || input === "\n") key("enter");
      else if (point === 127 || point === 8) key("backspace");
      else if (input === "\t") key("tab");
      else if (point === 0) key("space", " ", 5);
      else if (point < 32) {
        const letter = String.fromCharCode(point + (point <= 26 ? 96 : 64));
        key(letter, letter, 5);
      } else key(input, input);
    }
  }
  const data = (chunk: Buffer | string) => {
    clearTimeout(timer);
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    parse();
    if (paste === undefined && buffer === "\x1b") {
      timer = setTimeout(() => {
        if (buffer === "\x1b") key("escape");
        buffer = "";
      }, 30);
    }
  };
  stdin.on("data", data);
  return () => {
    clearTimeout(timer);
    stdin.off("data", data);
  };
}
