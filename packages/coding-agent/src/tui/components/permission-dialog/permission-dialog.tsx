import {
  Box,
  HintLine,
  ListItem,
  ScrollBox,
  ThemedText,
  useTerminalSize,
  type ScrollHandle,
  type ScrollSnapshot,
} from "../../../ink/index.ts";
import { useCallback, useState, type Ref } from "react";
import type { PermissionAskRequest } from "@neant/agent";
import type { PermissionMode } from "@neant/shared";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

/** The visible choices also define the keyboard decisions for this request. */
export function permissionChoices(
  mode: PermissionMode = "ask",
  locale: Locale = "zh",
  kind: PermissionAskRequest["sessionAllow"]["kind"] = "tool",
) {
  const t = createTuiI18n(locale);
  const allowOnce = { label: t("approval.allow-once"), decision: "allow" } as const;
  const allowSession = { label: t(`approval.allow-${kind}`), decision: "allow-session" } as const;
  const deny = { label: t("approval.deny"), decision: "deny" } as const;
  return mode === "auto-review" ? [allowOnce, deny] : [allowOnce, allowSession, deny];
}

export function PermissionDialog({
  toolName,
  sessionAllow,
  args,
  selected,
  maxHeight,
  scrollRef,
  scrollFocused = false,
  mode = "ask",
  locale = "zh",
  reason,
  origin,
  bottomGap = 1,
}: {
  toolName: string;
  sessionAllow: PermissionAskRequest["sessionAllow"];
  args: unknown;
  selected: number;
  maxHeight: number;
  scrollRef?: Ref<ScrollHandle>;
  scrollFocused?: boolean;
  mode?: PermissionMode;
  locale?: Locale;
  reason?: string;
  origin?: PermissionAskRequest["origin"];
  bottomGap?: 0 | 1;
}) {
  const { columns } = useTerminalSize();
  const t = createTuiI18n(locale);
  const choices = permissionChoices(mode, locale, sessionAllow.kind);
  const spacious = maxHeight >= choices.length + 6;
  const showQuestion = maxHeight >= choices.length + 4;
  const [detailHeight, setDetailHeight] = useState(1);
  const measureDetails = useCallback(({ total, width }: ScrollSnapshot) => {
    if (width > 0) setDetailHeight(total);
  }, []);
  // Only details consume the remaining budget; selection never changes the fixed rows.
  const fixedHeight = choices.length + 2 + Number(showQuestion) + (spacious ? 2 : 0);
  const height = Math.min(maxHeight, fixedHeight + Math.max(1, detailHeight));
  const source = origin
    ? `${t("permissions.origin", { description: origin.description.replace(/[\r\n]+/g, " ") })} · `
    : "";
  const title = ` ⏳ ${source}${t("dialog.title", { tool: toolName === "web_fetch" ? t("tool.web-fetch") : toolName })} `;
  const ruleWidth = Math.max(0, columns - 4 - Bun.stringWidth(title));
  const command =
    toolName === "bash" &&
    args !== null &&
    typeof args === "object" &&
    "command" in args &&
    typeof args.command === "string"
      ? args.command
      : undefined;
  const parameters =
    command === undefined
      ? args
      : Object.fromEntries(
          Object.entries(args ?? {}).filter(([key]) => key !== "command" && key !== "description"),
        );
  return (
    <Box flexDirection="column" height={height} paddingX={2} marginBottom={bottomGap}>
      <ThemedText color="permission" wrap="truncate">
        {`${"─".repeat(Math.floor(ruleWidth / 2))}${title}${"─".repeat(Math.ceil(ruleWidth / 2))}`}
      </ThemedText>
      {spacious && <Box height={1} flexShrink={0} />}
      <ScrollBox ref={scrollRef} initialFollow={false} onScroll={measureDetails}>
        {command !== undefined && (
          <Box paddingX={2}>
            <ThemedText dimColor preserveWhitespace>
              {command}
            </ThemedText>
          </Box>
        )}
        {(command === undefined || Object.keys(parameters ?? {}).length > 0) && (
          <Box paddingX={2}>
            <ThemedText dimColor preserveWhitespace>
              {JSON.stringify(parameters, null, 2)}
            </ThemedText>
          </Box>
        )}
        {reason !== undefined && <ThemedText dimColor>{reason}</ThemedText>}
      </ScrollBox>
      {showQuestion && (
        <ThemedText dimColor wrap="truncate">
          {t("dialog.question")}
        </ThemedText>
      )}
      <Box flexDirection="column" marginTop={spacious ? 1 : 0} flexShrink={0}>
        {choices.map(({ label }, index) => (
          <ListItem
            key={label}
            focused={selected === index}
            singleLine={maxHeight < 6}
          >{`${index + 1}. ${label}`}</ListItem>
        ))}
      </Box>
      <HintLine>
        {[
          t("dialog.select"),
          t("dialog.confirm"),
          t("dialog.deny"),
          t(scrollFocused ? "dialog.transcript" : "dialog.details"),
        ].join(columns < 50 ? " " : " · ")}
      </HintLine>
    </Box>
  );
}
