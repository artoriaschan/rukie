import { useLayoutEffect, useRef } from "react";
import { useSelection } from "../../ink/index.ts";
import type { TuiHost } from "../host";
export type CopyOutcome = "copied" | "sent" | "unavailable" | "stale";

/** Selection is read from this render root; asynchronous clipboard transport belongs to the product host. */
export function useHostSelection(
  enabled: boolean,
  owner: string,
  viewportKey: string,
  background: string,
  host: Pick<TuiHost, "writeClipboard">,
  onResult: (outcome: CopyOutcome) => void,
) {
  const selection = useSelection();
  const generation = useRef(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useLayoutEffect(() => {
    selection.clearSelection();
  }, [selection, viewportKey]);
  const current = useRef({ enabled, owner, host, onResult });
  current.current = { enabled, owner, host, onResult };
  useLayoutEffect(() => {
    selection.setSelectionBgColor(background);
  }, [selection, background]);
  useLayoutEffect(() => {
    generation.current++;
    selection.clearSelection();
  }, [selection, enabled, owner]);
  useLayoutEffect(
    () =>
      selection.subscribe(() => {
        const state = selection.getState();
        if (!state?.anchor || state.isDragging) return;
        const live = current.current;
        if (!live.enabled) {
          selection.clearSelection();
          return;
        }
        const token = generation.current;
        const text = state.stale ? "" : selection.readSelectionText();
        const stale = state.stale;
        selection.clearSelection();
        if (stale) {
          live.onResult("stale");
          return;
        }
        if (!text) return;
        void Promise.resolve()
          .then(() =>
            mounted.current &&
            generation.current === token &&
            current.current.enabled &&
            current.current.owner === live.owner
              ? live.host.writeClipboard(text)
              : false,
          )
          .catch(() => false)
          .then((result) => {
            if (
              mounted.current &&
              generation.current === token &&
              current.current.enabled &&
              current.current.owner === live.owner
            )
              current.current.onResult(
                result === "sent" ? "sent" : result ? "copied" : "unavailable",
              );
          });
      }),
    [selection],
  );
  return selection;
}
