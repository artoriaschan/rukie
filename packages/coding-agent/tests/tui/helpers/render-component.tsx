import type { ReactNode } from "react";
import {
  AlternateScreen,
  renderSync,
  useInput,
  type RenderOptions,
} from "../../../src/ink/index.ts";
function Content({ children }: { children: ReactNode }) {
  useInput(() => {});
  return <AlternateScreen>{children}</AlternateScreen>;
}
/** Component fixtures exercise runTui's alternate-screen input and completed paint lifecycle. */
export function renderComponent(node: ReactNode, options: RenderOptions) {
  const app = renderSync(<Content>{node}</Content>, {
    ...options,
    selectionIncludeNoSelectCells: false,
  });
  return {
    ...app,
    rerender(next: ReactNode) {
      app.rerender(<Content>{next}</Content>);
    },
  };
}
