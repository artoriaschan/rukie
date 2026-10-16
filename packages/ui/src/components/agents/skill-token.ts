import {
  $applyNodeReplacement,
  $createTextNode,
  RootNode,
  type LexicalEditor,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  TextNode,
  type EditorConfig,
  type NodeKey,
  type SerializedTextNode,
} from "lexical";
import type { WireSkill } from "@rukie/shared";

type SerializedSkill = SerializedTextNode & { type: "skill-token"; skill: WireSkill };

/** A skill is atomic editor content; transport remains the existing slash syntax. */
export class SkillTokenNode extends TextNode {
  __skill: WireSkill;
  static getType() {
    return "skill-token";
  }
  static clone(node: SkillTokenNode) {
    return new SkillTokenNode(node.__skill, node.__key);
  }
  constructor(skill: WireSkill, key?: NodeKey) {
    super(skill.name, key);
    this.__skill = skill;
  }
  static importJSON(serialized: SerializedSkill) {
    return $createSkillToken(serialized.skill);
  }
  exportJSON(): SerializedSkill {
    return { ...super.exportJSON(), type: "skill-token", skill: this.__skill };
  }
  createDOM(config: EditorConfig) {
    const dom = super.createDOM(config);
    dom.classList.add("composer-skill-token");
    dom.dataset.skillToken = this.__skill.name;
    return dom;
  }
  isTextEntity() {
    return true;
  }
  canInsertTextBefore() {
    return false;
  }
  canInsertTextAfter() {
    return false;
  }
}
export function $createSkillToken(skill: WireSkill) {
  return $applyNodeReplacement(new SkillTokenNode(skill)).setMode("token");
}
export function $serializePrompt() {
  const root = $getRoot();
  const first = root.getFirstChild();
  const token = $isElementNode(first) ? first.getFirstChild() : null;
  const text = root.getTextContent();
  return token instanceof SkillTokenNode ? `/${text}` : text;
}

/** Normalize after every edit, including native typing, paste, linebreaks and history. */
export function registerSkillTokenInvariant(editor: LexicalEditor) {
  return editor.registerNodeTransform(RootNode, (root) => {
    const tokens = root.getAllTextNodes().filter((node) => node instanceof SkillTokenNode);
    const token = tokens[0];
    if (!token) return;
    for (const duplicate of tokens.slice(1))
      duplicate.replace($createTextNode(`/${duplicate.getTextContent()}`));
    const first = root.getFirstChild();
    if (!$isElementNode(first) || first.getFirstChild() === token) return;
    const selection = $getSelection();
    const points = $isRangeSelection(selection)
      ? [selection.anchor, selection.focus].map((point) => ({
          key: point.key,
          offset: point.offset,
          type: point.type,
        }))
      : [];
    const previous = token.getPreviousSibling();
    const parent = token.getParent();
    const index = token.getIndexWithinParent();
    const beginning = first.getFirstChild();
    if (beginning) beginning.insertBefore(token);
    else first.append(token);
    const following = token.getNextSibling();
    if (following && !/^\s/.test(following.getTextContent()))
      token.insertAfter($createTextNode(" "));
    if ($isRangeSelection(selection)) {
      for (const [i, point] of points.entries()) {
        if (point.key === token.getKey() && point.offset === 0 && previous) {
          (i === 0 ? selection.anchor : selection.focus).set(
            first.getKey(),
            previous.getIndexWithinParent() + 1,
            "element",
          );
          continue;
        }
        let offset = point.offset;
        if (point.type === "element") {
          if (point.key === parent?.getKey() && offset > index) offset--;
          if (point.key === first.getKey()) offset++;
        }
        (i === 0 ? selection.anchor : selection.focus).set(point.key, offset, point.type);
      }
    }
  });
}
