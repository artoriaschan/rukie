import { HintLine, ListItem, ThemedBox, ThemedText } from "../../../ink/index.ts";
import type { SessionSummary } from "@rukie/agent";
import type { Locale } from "@rukie/i18n";
import { createTuiI18n } from "../../../view/i18n";

/** Two-line rows stay bounded and keep the focused session visible. */
export function SessionPicker({
  sessions,
  focus,
  maxHeight,
  locale,
  onPick,
}: {
  sessions: readonly SessionSummary[];
  focus: number;
  maxHeight: number;
  locale: Locale;
  onPick(index: number): void;
}) {
  const t = createTuiI18n(locale);
  const count = Math.max(1, Math.floor((maxHeight - 4) / 2));
  const start = Math.max(0, Math.min(sessions.length - count, focus - Math.floor(count / 2)));
  const date = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <ThemedBox
      flexDirection="column"
      borderStyle="single"
      color="permission"
      paddingX={1}
      flexShrink={0}
    >
      <ThemedText color="permission" bold wrap="truncate">
        {t("resume.title")}
      </ThemedText>
      {sessions.slice(start, start + count).map((session, index) => (
        <ListItem
          key={session.id}
          picker
          singleLine
          focused={focus === start + index}
          showScrollUp={index === 0 && start > 0}
          showScrollDown={index === count - 1 && start + count < sessions.length}
          description={`${date.format(session.updatedAt)} · ${t("resume.messages", { count: session.messageCount })} · ${session.model}`}
          onClick={() => onPick(start + index)}
        >
          <ThemedText dimColor={session.titleSource === "prompt"} wrap="truncate">
            {session.title}
          </ThemedText>
        </ListItem>
      ))}
      <HintLine>{t("resume.hint")}</HintLine>
    </ThemedBox>
  );
}
