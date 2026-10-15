import { isWireUserVisibleErrorCode } from "@rukie/shared";
import { WireError } from "../client";
import { useAppText } from "../lib/i18n";

/** Protocol and unexpected transport failures have localized, safe presentation copy. */
export function useErrorText() {
  const t = useAppText();
  return (reason: unknown) =>
    t(
      reason instanceof WireError
        ? isWireUserVisibleErrorCode(reason.code)
          ? `error.${reason.code}`
          : `app.error-${reason.code}`
        : "app.error-internal",
      reason instanceof WireError ? reason.params : undefined,
    );
}
