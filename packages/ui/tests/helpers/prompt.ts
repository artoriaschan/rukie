/** Read the visible editable draft, including line breaks and untrimmed whitespace. */
export function promptText(element: Element): string {
  if (!(element instanceof HTMLElement)) throw new Error("Prompt must be an HTML element");
  const text = element.innerText;
  // A final BR keeps an empty editable line visible; it adds no draft character.
  return element.lastElementChild?.lastChild?.nodeName === "BR" ? text.slice(0, -1) : text;
}
