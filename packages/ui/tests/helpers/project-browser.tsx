import type { ReactNode } from "react";
import { onTestFinished, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

/** Register before the first acquisition or global mutation; release in frontend ownership order. */
export function ownProjectBrowserTest() {
  const previousViewport = { width: innerWidth, height: innerHeight };
  const previousStyle = document.documentElement.getAttribute("style");
  const previousClass = document.documentElement.className;
  const previousReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let connection: Awaited<ReturnType<typeof commands.startWire>> | undefined;
  let screen: Awaited<ReturnType<typeof render>> | undefined;
  let rendering = false;
  let closing: Promise<void> | undefined;
  let closed = false;
  const close = () =>
    (closing ??= (async () => {
      closed = true;
      const errors: unknown[] = [];
      const release = async (action: () => unknown) => {
        try {
          await action();
        } catch (error) {
          errors.push(error);
        }
      };
      if (screen) await release(() => screen!.unmount());
      // render can reject after React has acquired a root, before returning its unmount handle.
      if (rendering) await release(cleanup);
      if (connection) await release(() => commands.stopWire(connection!.port));
      await release(() => vi.useRealTimers());
      await release(() => {
        document.documentElement.className = previousClass;
      });
      await release(() => {
        if (previousStyle === null) document.documentElement.removeAttribute("style");
        else document.documentElement.setAttribute("style", previousStyle);
      });
      await release(() => page.viewport(previousViewport.width, previousViewport.height));
      await release(() => commands.reducedMotion(previousReducedMotion));
      if (errors.length) throw new AggregateError(errors, "Project browser cleanup failed");
    })());
  onTestFinished(close);
  return {
    close,
    startWire: async () => {
      const acquired = await commands.startWire();
      if (closed) {
        await commands.stopWire(acquired.port);
        throw new Error("Project browser owner closed during wire acquisition");
      }
      return (connection = acquired);
    },
    render: async (ui: ReactNode) => {
      if (closed) throw new Error("Project browser owner already closed");
      rendering = true;
      const acquired = await render(ui);
      if (closed) {
        await acquired.unmount();
        throw new Error("Project browser owner closed during render");
      }
      return (screen = acquired);
    },
  };
}
