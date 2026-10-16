import "./agents/skill-picker.css";
import type { WireSkill } from "@rukie/shared";
import { literalClipboardHtml, skillMarkdown } from "./agents/skill-clipboard";

/** Historical invocation is a persisted fact; the live catalog supplies only a copy path. */
export function SkillPrompt({
  text,
  invocation,
  skills = [],
}: {
  text: string;
  invocation?: string;
  skills?: readonly WireSkill[];
}) {
  const name = invocation ? /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/.exec(text)?.[1] : undefined;
  const prefix = name ? `/${name}` : "";
  const marked = Boolean(name);
  return (
    <div
      data-user-prompt
      className="whitespace-pre-wrap break-words"
      onCopy={(event) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const fragment = range.cloneContents();
        const ancestor = range.commonAncestorContainer;
        const tokenAncestor = (
          ancestor instanceof Element ? ancestor : ancestor.parentElement
        )?.closest<HTMLElement>("[data-skill-token]");
        if (tokenAncestor && fragment.textContent === tokenAncestor.textContent) {
          const wrapper = tokenAncestor.cloneNode(false);
          wrapper.appendChild(fragment.cloneNode(true));
          fragment.replaceChildren(wrapper);
        }
        let found = false;
        fragment.querySelectorAll<HTMLElement>("[data-skill-token]").forEach((token) => {
          const name = token.dataset.skillToken!;
          const skill = skills.find((skill) => skill.name === name);
          token.replaceWith(document.createTextNode(skill ? skillMarkdown(skill) : `/${name}`));
          found = true;
        });
        if (!found) return;
        const copied = fragment.textContent ?? "";
        event.preventDefault();
        event.clipboardData.setData("text/plain", copied);
        event.clipboardData.setData("text/html", literalClipboardHtml(copied));
      }}
    >
      {marked ? (
        <>
          <span className="composer-skill-token" data-skill-token={name}>
            {name}
          </span>
          {text.slice(prefix.length)}
        </>
      ) : (
        text
      )}
    </div>
  );
}
