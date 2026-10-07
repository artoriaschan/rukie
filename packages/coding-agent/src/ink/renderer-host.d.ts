// Host names are internal to the vendored reconciler; public components retain their typed props.
import type {} from "react";
declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "ink-box": unknown;
      "ink-text": unknown;
      "ink-link": unknown;
      "ink-image": unknown;
      "ink-raw": unknown;
      "ink-raw-ansi": unknown;
    }
  }
}
