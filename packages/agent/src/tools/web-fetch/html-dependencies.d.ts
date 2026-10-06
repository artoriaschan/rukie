// These locked dependencies do not ship usable declarations for these package names. Keep this surface limited
// to the DOM operations used to remove non-content HTML before conversion.
declare module "@mixmark-io/domino" {
  interface Element {
    nodeName: string;
    innerHTML: string;
    parentNode: Element | null;
    removeChild(node: Element): void;
    hasAttribute(name: string): boolean;
    removeAttribute(name: string): void;
    getAttribute(name: string): string | null;
  }
  export function createDocument(html: string): {
    body: Element | null;
    querySelectorAll(selector: string): ArrayLike<Element>;
  };
}

declare module "@joplin/turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export const gfm: TurndownService.Plugin;
}
