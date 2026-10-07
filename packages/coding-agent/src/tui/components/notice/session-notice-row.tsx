import { Box, ThemedText } from "../../../ink/index.ts";
import type { Locale } from "@rukie/i18n";
import type { SessionNotice } from "@rukie/agent";
import { createTuiI18n, formatError } from "../../../view/i18n";
import { Notice } from "./notice";

export function SessionNoticeRow({ notice, locale }: { notice: SessionNotice; locale: Locale }) {
  const t = createTuiI18n(locale);
  if (notice.kind === "hook_message") return <Notice kind="info" text={notice.message} divider />;
  if (notice.kind === "hook_warning")
    return (
      <Notice
        kind="warning"
        text={t("notice.hook-warning", {
          event: notice.event,
          hook: notice.hook,
          message: formatError({ ...notice.error, message: notice.message }, t),
        }).replace(/\s+/g, " ")}
        divider
      />
    );
  if (notice.kind === "interrupted")
    return (
      <Box flexDirection="column" marginTop={1}>
        <ThemedText dimColor>{t("notice.interrupted")}</ThemedText>
        <ThemedText dimColor>{t("notice.interrupted-next")}</ThemedText>
      </Box>
    );
  if (notice.kind === "error")
    return (
      <Box marginTop={1}>
        <Notice kind="error" text={`✗ ${formatError({ message: notice.reason ?? "" }, t)}`} />
      </Box>
    );
  return (
    <Notice
      kind="info"
      divider
      text={t(notice.kind === "hook_blocked" ? "notice.hook-blocked" : "notice.hook-stopped", {
        reason: notice.reason ?? "",
      })}
    />
  );
}
