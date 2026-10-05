import { useEffect, useRef, useState } from "react";
import {
  Box,
  Divider,
  ScrollBox,
  ThemedBox,
  ThemedText,
  useInput,
  useTerminalSize,
  type ScrollHandle,
} from "@neant/tui";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

/** Field values are local presentation drafts; this screen has no settings writer. */
type SettingsField = { id: string; label: string; hint?: string } & (
  | { kind: "boolean"; value: boolean }
  | { kind: "enum"; value: string; options: readonly { value: string; label: string }[] }
);
interface SettingsSection {
  id: string;
  title: string;
  fields: readonly SettingsField[];
}

/** Settings page framework. No sections are registered by the application yet. */
export function SettingsScreen({
  locale,
  onClose,
  sections = [],
}: {
  locale: Locale;
  onClose(): void;
  sections?: readonly SettingsSection[];
}) {
  const t = createTuiI18n(locale);
  const { columns, rows } = useTerminalSize();
  const [focus, setFocus] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>({});
  const scroll = useRef<ScrollHandle>(null);
  const fields = sections.flatMap((section) =>
    section.fields.map((field) => ({ field, key: `${section.id}/${field.id}` })),
  );
  const selected = fields[focus];
  const valueOf = (key: string, field: SettingsField) => drafts[key] ?? field.value;
  const cycle = (direction: 1 | -1) => {
    if (!selected) return;
    const { field, key } = selected;
    const value = valueOf(key, field);
    if (field.kind === "boolean") setDrafts((current) => ({ ...current, [key]: !value }));
    else if (field.options.length) {
      const index = field.options.findIndex((option) => option.value === value);
      const next = (index + direction + field.options.length) % field.options.length;
      setDrafts((current) => ({ ...current, [key]: field.options[next]!.value }));
    }
  };
  useInput((event) => {
    if (event.type !== "key") return;
    const { key } = event;
    if (key.name === "escape") onClose();
    else if (!key.ctrl && !key.alt && !key.shift) {
      if (key.name === "up") setFocus((current) => Math.max(0, current - 1));
      else if (key.name === "down")
        setFocus((current) => Math.min(Math.max(0, fields.length - 1), current + 1));
      else if (key.name === "enter") cycle(1);
      else if (selected?.field.kind === "enum" && (key.name === "left" || key.name === "right"))
        cycle(key.name === "left" ? -1 : 1);
    }
  });
  useEffect(() => {
    let offset = 0;
    for (const section of sections) {
      offset++;
      for (const field of section.fields) {
        if (`${section.id}/${field.id}` === selected?.key) {
          const viewport = scroll.current?.getSnapshot();
          if (viewport && offset < viewport.top) scroll.current?.scrollBy(offset - viewport.top);
          else if (viewport && offset >= viewport.top + viewport.height)
            scroll.current?.scrollBy(offset - viewport.top - viewport.height + 1);
          return;
        }
        offset++;
      }
      offset += 2;
    }
  }, [focus, selected?.key, sections, rows]);
  return (
    <Box width={columns} height={rows} flexDirection="column">
      <Box height={1} flexShrink={0}>
        <ThemedText bold>{t("settings.title")}</ThemedText>
        <Box flexGrow={1} />
        {fields.length > 0 && <ThemedText dimColor>{`${focus + 1}/${fields.length}`}</ThemedText>}
      </Box>
      <ScrollBox ref={scroll} initialFollow={false} height={Math.max(1, rows - 4)} flexGrow={1}>
        {sections.length === 0 ? (
          <ThemedText dimColor wrap="truncate">
            {t("settings.empty")}
          </ThemedText>
        ) : (
          sections.map((section) => (
            <Box key={section.id} flexDirection="column" marginBottom={1}>
              <ThemedText
                color="subtle"
                wrap="truncate"
              >{`╭─ ${section.title} ${"─".repeat(Math.max(0, columns - Bun.stringWidth(section.title) - 5))}╮`}</ThemedText>
              {section.fields.map((field) => {
                const key = `${section.id}/${field.id}`;
                const focused = key === selected?.key;
                const value = valueOf(key, field);
                const display =
                  field.kind === "boolean"
                    ? value
                      ? "[✓ ]"
                      : "[  ]"
                    : `‹ ${field.options.find((option) => option.value === value)?.label ?? value} ›`;
                return (
                  <Box key={field.id} height={1} flexShrink={0}>
                    <ThemedText color="subtle">│</ThemedText>
                    <ThemedBox
                      flexGrow={1}
                      paddingX={1}
                      backgroundColor={focused ? "badgeHoverBackground" : undefined}
                    >
                      <ThemedText color={focused ? "suggestion" : undefined}>
                        {focused ? "❯ " : "  "}
                      </ThemedText>
                      <ThemedText bold={focused} wrap="truncate">
                        {field.label}
                      </ThemedText>
                      <Box flexGrow={1} />
                      <ThemedText
                        color={
                          field.kind === "boolean"
                            ? value
                              ? "success"
                              : "inactive"
                            : focused
                              ? "suggestion"
                              : undefined
                        }
                      >
                        {display}
                      </ThemedText>
                    </ThemedBox>
                    <ThemedText color="subtle">│</ThemedText>
                  </Box>
                );
              })}
              <ThemedText
                color="subtle"
                wrap="truncate"
              >{`╰${"─".repeat(Math.max(0, columns - 2))}╯`}</ThemedText>
            </Box>
          ))
        )}
      </ScrollBox>
      <Divider />
      <ThemedText color="success"> </ThemedText>
      <Box height={1} flexShrink={0}>
        <ThemedText dimColor italic wrap="truncate">
          {selected?.field.hint ?? ""}
        </ThemedText>
        <Box flexGrow={1} />
        <ThemedText dimColor italic wrap="truncate">
          <ThemedText bold>Enter</ThemedText>
          {` ${t("settings.hint")}`}
        </ThemedText>
      </Box>
    </Box>
  );
}
