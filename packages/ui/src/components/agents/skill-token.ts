import {
  $applyNodeReplacement,
  $getRoot,
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
