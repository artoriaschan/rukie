import { diffLines, diffWordsWithSpace } from "diff";
import { ThemedBox, ThemedText } from "./themed";
import type { SyntaxRun } from "./syntax-highlighted-text";

/** Prelexed unified rows, with source prefixes and file/hunk boundaries. */
export interface SplitDiffLine {
  text: string;
  tone: "path" | "add" | "del" | "dim" | "plain";
  path?: string;
  runs?: SyntaxRun[];
}
interface WordRun extends SyntaxRun {
  changed?: boolean;
}
export type SplitDiffRow =
  | { text: string; path?: string }
  | { old?: WordRun[]; new?: WordRun[]; oldChanged?: boolean; newChanged?: boolean };

function sourceRuns(line: SplitDiffLine): SyntaxRun[] {
  const runs = line.runs ?? [{ text: line.text }];
  let skip = 1;
  return runs.flatMap((run) => {
    const text = run.text.slice(skip);
    skip = Math.max(0, skip - run.text.length);
    return text ? [{ ...run, text }] : [];
  });
}
function changedRuns(runs: SyntaxRun[], words: { text: string; changed: boolean }[]): WordRun[] {
  const out: WordRun[] = [];
  let index = 0,
    offset = 0;
  for (const run of runs) {
    let remaining = run.text;
    while (remaining) {
      const word = words[index];
      if (!word) {
        out.push({ ...run, text: remaining });
        break;
      }
      const length = Math.min(remaining.length, word.text.length - offset);
      out.push({ ...run, text: remaining.slice(0, length), changed: word.changed });
      remaining = remaining.slice(length);
      offset += length;
      if (offset === word.text.length) {
        index++;
        offset = 0;
      }
    }
  }
  return out;
}
/** Align replacement blocks into panes while retaining paths and hunk gaps. */
export function alignSplitDiff(lines: readonly SplitDiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (line.tone === "path" || line.tone === "dim") {
      rows.push({ text: line.text, path: line.path });
      index++;
      continue;
    }
    if (line.tone === "plain") {
      const runs = sourceRuns(line);
      rows.push({ old: runs, new: runs });
      index++;
      continue;
    }
    const removed: SplitDiffLine[] = [],
      added: SplitDiffLine[] = [];
    while (lines[index]?.tone === "del") removed.push(lines[index++]!);
    while (lines[index]?.tone === "add") added.push(lines[index++]!);
    const pairs: [number, number][] = [];
    if (removed.length === added.length) {
      removed.forEach((_line, index) => pairs.push([index, index]));
    } else {
      // Match unchanged words modulo case before pairing unequal replacement blocks.
      // An insertion above a changed line must not shift that line to another partner.
      let oldIndex = 0,
        newIndex = 0;
      for (const part of diffLines(
        removed.map((line) => line.text.slice(1).toLowerCase() + "\n").join(""),
        added.map((line) => line.text.slice(1).toLowerCase() + "\n").join(""),
      )) {
        const count = part.count ?? 0;
        if (!part.added && !part.removed) {
          for (let i = 0; i < count; i++) pairs.push([oldIndex++, newIndex++]);
        } else if (part.removed) oldIndex += count;
        else newIndex += count;
      }
    }
    const emit = (oldLine?: SplitDiffLine, newLine?: SplitDiffLine) => {
      const old = oldLine ? sourceRuns(oldLine) : undefined;
      const next = newLine ? sourceRuns(newLine) : undefined;
      if (old && next) {
        const parts = diffWordsWithSpace(oldLine!.text.slice(1), newLine!.text.slice(1));
        rows.push({
          old: changedRuns(
            old,
            parts
              .filter((part) => !part.added)
              .map((part) => ({ text: part.value, changed: !!part.removed })),
          ),
          new: changedRuns(
            next,
            parts
              .filter((part) => !part.removed)
              .map((part) => ({ text: part.value, changed: !!part.added })),
          ),
          oldChanged: true,
          newChanged: true,
        });
      } else rows.push({ old, new: next, oldChanged: !!old, newChanged: !!next });
    };
    let oldIndex = 0,
      newIndex = 0;
    for (const [oldPair, newPair] of pairs) {
      while (oldIndex < oldPair) emit(removed[oldIndex++]);
      while (newIndex < newPair) emit(undefined, added[newIndex++]);
      emit(removed[oldIndex++], added[newIndex++]);
    }
    while (oldIndex < removed.length) emit(removed[oldIndex++]);
    while (newIndex < added.length) emit(undefined, added[newIndex++]);
  }
  return rows;
}

/** One terminal row per aligned line; fixed pane widths truncate rather than wrap. */
export function SplitDiffView({
  rows,
  width,
  onToggle,
  onPathClick,
}: {
  rows: readonly SplitDiffRow[];
  width: number;
  onToggle?(): void;
  onPathClick?(path: string): void;
}) {
  const available = Math.max(0, width - 3);
  const left = Math.floor(available / 2),
    right = available - left;
  const hitWidth = (runs: WordRun[] | undefined, paneWidth: number) =>
    Math.min(
      paneWidth,
      runs
        ? 1 +
            Bun.stringWidth(
              runs
                .map((run) => run.text.replace(/\t/g, "   "))
                .join("")
                .trimEnd(),
            )
        : 0,
    );
  return (
    <ThemedBox flexDirection="column" width={Math.max(0, width)}>
      {rows.map((row, index) =>
        "text" in row ? (
          <ThemedBox
            key={index}
            width={Math.min(width, Bun.stringWidth(row.text))}
            onClick={row.path && onPathClick ? () => onPathClick(row.path!) : onToggle}
          >
            <ThemedText
              color={row.path ? undefined : "subtle"}
              underline={!!row.path}
              wrap="truncate"
            >
              {row.text}
            </ThemedText>
          </ThemedBox>
        ) : (
          <ThemedBox key={index} height={1}>
            <ThemedBox width={left}>
              <ThemedBox width={hitWidth(row.old, left)} onClick={row.old ? onToggle : undefined}>
                <Pane runs={row.old} side="old" changed={row.oldChanged} />
              </ThemedBox>
            </ThemedBox>
            <ThemedBox width={Math.min(3, width)}>
              <ThemedText dimColor preserveWhitespace>
                {width >= 3 ? " │ " : ""}
              </ThemedText>
            </ThemedBox>
            <ThemedBox width={right}>
              <ThemedBox width={hitWidth(row.new, right)} onClick={row.new ? onToggle : undefined}>
                <Pane runs={row.new} side="new" changed={row.newChanged} />
              </ThemedBox>
            </ThemedBox>
          </ThemedBox>
        ),
      )}
    </ThemedBox>
  );
}
function Pane({
  runs,
  side,
  changed,
}: {
  runs?: WordRun[];
  side: "old" | "new";
  changed?: boolean;
}) {
  const tone = side === "old" ? "error" : "success";
  return (
    <ThemedText wrap="truncate" preserveWhitespace>
      <ThemedText color={changed ? tone : "subtle"}>
        {runs ? (changed ? (side === "old" ? "-" : "+") : " ") : ""}
      </ThemedText>
      {runs?.map((run, index) => (
        <ThemedText
          key={index}
          color={run.changed ? "inverseText" : run.color}
          backgroundColor={run.changed ? tone : undefined}
          bold={run.changed}
        >
          {run.text.replace(/\t/g, "   ")}
        </ThemedText>
      ))}
    </ThemedText>
  );
}
