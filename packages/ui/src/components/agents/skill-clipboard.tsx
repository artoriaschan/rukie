import { $generateJSONFromSelectedNodes } from "@lexical/clipboard";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $addUpdateTag,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  CUT_COMMAND,
  CUT_TAG,
  PASTE_COMMAND,
  PASTE_TAG,
  mergeRegister,
} from "lexical";
import { useEffect } from "react";
import type { WireSkill } from "@rukie/shared";
import { $createSkillToken, SkillTokenNode } from "./skill-token";

export function skillMarkdown(skill: Pick<WireSkill, "name" | "filePath">) {
  return `[$${skill.name}](${skill.filePath})`;
}
export function literalClipboardHtml(text: string) {
  return `<pre>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function clipboardSkill(value: unknown): value is WireSkill {
  return (
    record(value) &&
    typeof value.name === "string" &&
    typeof value.filePath === "string" &&
    typeof value.description === "string" &&
    (value.scope === "project" || value.scope === "user")
  );
}
function serializedText(value: unknown): string {
  if (!record(value)) return "";
  if (value.type === "skill-token" && clipboardSkill(value.skill))
    return skillMarkdown(value.skill);
  if (value.type === "linebreak") return "\n";
  if (typeof value.text === "string") return value.text;
  return Array.isArray(value.children) ? value.children.map(serializedText).join("") : "";
}
function serializedNodesText(nodes: unknown[]) {
  return nodes
    .map(
      (node, index) =>
        `${index > 0 && record(node) && node.type === "paragraph" ? "\n\n" : ""}${serializedText(node)}`,
    )
    .join("");
}
function internalPayload(raw: string): { text: string; skill?: WireSkill } | undefined {
  try {
    const data: unknown = JSON.parse(raw);
    if (!record(data) || data.namespace !== "rukie-prompt" || !Array.isArray(data.nodes)) return;
    const first: unknown = data.nodes[0];
    const token: unknown =
      record(first) && Array.isArray(first.children) ? first.children[0] : first;
    return {
      text: serializedNodesText(data.nodes),
      ...(record(token) && token.type === "skill-token" && clipboardSkill(token.skill)
        ? { skill: token.skill }
        : {}),
    };
  } catch {
    return;
  }
}
/** Clipboard formats preserve semantic tokens without changing their editable text. */
export function SkillClipboard({ skills = [] }: { skills?: readonly WireSkill[] }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const copy = (event: ClipboardEvent | KeyboardEvent | null, cut: boolean) => {
      const selection = $getSelection();
      if (
        !$isRangeSelection(selection) ||
        selection.isCollapsed() ||
        !event ||
        !("clipboardData" in event) ||
        !event.clipboardData
      )
        return false;
      const payload = $generateJSONFromSelectedNodes(editor, selection);
      const text = serializedNodesText(payload.nodes);
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
      event.clipboardData.setData("text/html", literalClipboardHtml(text));
      event.clipboardData.setData("application/x-lexical-editor", JSON.stringify(payload));
      if (cut) {
        $addUpdateTag(CUT_TAG);
        selection.removeText();
      }
      return true;
    };
    return mergeRegister(
      editor.registerCommand(COPY_COMMAND, (event) => copy(event, false), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(CUT_COMMAND, (event) => copy(event, true), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          const selection = $getSelection();
          if (
            !$isRangeSelection(selection) ||
            !(event instanceof ClipboardEvent) ||
            !event.clipboardData
          )
            return false;
          const data = event.clipboardData;
          const internal = internalPayload(data.getData("application/x-lexical-editor"));
          const text = internal?.text ?? data.getData("text/plain");
          const match = /^\[\$([^\]\r\n]+)\]\(([^\r\n]*SKILL\.md)\)/.exec(text);
          const skill =
            internal?.skill ??
            (match ? skills.find((skill) => skill.name === match[1]) : undefined);
          if (!match || !skill) return false;
          const point = selection.isBackward() ? selection.focus : selection.anchor;
          const first = $getRoot().getFirstChild();
          const node = point.getNode();
          const atStart =
            point.offset === 0 &&
            (node === first || ($isElementNode(first) && node === first.getFirstDescendant()));
          event.preventDefault();
          $addUpdateTag(PASTE_TAG);
          if (!atStart) {
            selection.insertRawText(text);
            return true;
          }
          selection.removeText();
          if ($isElementNode(first)) {
            const old = first.getFirstChild();
            if (old instanceof SkillTokenNode) {
              old.remove();
              const following = first.getFirstChild();
              if ($isTextNode(following) && following.getTextContent().startsWith(" "))
                following.spliceText(0, 1, "");
            }
            first.selectStart();
          }
          const current = $getSelection();
          if ($isRangeSelection(current))
            current.insertNodes([
              $createSkillToken(skill),
              $createTextNode(` ${text.slice(match[0].length).replace(/^ /, "")}`),
            ]);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor, skills]);
  return null;
}
