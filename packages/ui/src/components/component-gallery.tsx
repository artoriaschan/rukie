import { useState, useEffect } from "react";
import { Button } from "./motion/button/base";
import { Popover, PopoverTrigger, PopoverContent } from "./motion/popover";
import { Tooltip } from "./motion/tooltip";
import { CommandPalette } from "./motion/command-palette";
import { ToolApproval } from "./agents/tool-approval";
import { ToolResult, ToolResultOutput } from "./agents/tool-result";
import { CodeBlock } from "./agents/code-block";
import { TodoList } from "./agents/todo-list";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { UiLocaleProvider, useComponentText } from "../lib/i18n";

/** Isolated registry acceptance surface; the desktop app composes these same components. */
export function ComponentGallery() {
  const [dark, setDark] = useState(false);
  const [locale, setLocale] = useState<"zh" | "en">("en");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    document.documentElement.lang = locale;
  }, [dark, locale]);
  return (
    <UiLocaleProvider locale={locale}>
      <GalleryContent
        dark={dark}
        onTheme={() => setDark(!dark)}
        locale={locale}
        onLocale={() => setLocale(locale === "en" ? "zh" : "en")}
      />
    </UiLocaleProvider>
  );
}

function GalleryContent({
  dark,
  onTheme,
  locale,
  onLocale,
}: {
  dark: boolean;
  onTheme: () => void;
  locale: "zh" | "en";
  onLocale: () => void;
}) {
  const componentText = useComponentText();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [decision, setDecision] = useState<"pending" | "approved" | "denied">("pending");
  const [result, setResult] = useState("");
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6 text-ui-base">
      <h1 className="text-ui-xl font-semibold">{componentText("component.gallery")}</h1>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onTheme}>
          {componentText(dark ? "component.light" : "component.dark")}
        </Button>
        <Button variant="secondary" onClick={onLocale}>
          {locale === "en" ? "中文" : "English"}
        </Button>
        <Tooltip content={componentText("component.command-palette")}>
          <Button onClick={() => setPaletteOpen(true)}>
            {componentText("component.commands")}
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">{componentText("component.menu")}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => setResult(componentText("component.open-project"))}>
                {componentText("component.open-project")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger>
            <Button variant="outline">{componentText("component.context")}</Button>
          </PopoverTrigger>
          <PopoverContent>
            <section
              aria-label={componentText("component.context")}
              className="flex max-w-full flex-col gap-3 p-4"
            >
              <h2 className="text-ui-lg">{componentText("component.context")}</h2>
              <p className="text-ui-sm text-muted-foreground">
                {componentText("component.context-detail")}
              </p>
              <Button size="sm" onClick={() => setResult(componentText("component.done"))}>
                {componentText("component.done")}
              </Button>
            </section>
          </PopoverContent>
        </Popover>
      </div>
      <output aria-live="polite">{result}</output>
      <ToolApproval
        tool="bash"
        description={componentText("component.review-command")}
        status={decision}
        onApprove={() => setDecision("approved")}
        onAlwaysAllow={() => setDecision("approved")}
        onDeny={() => setDecision("denied")}
        parameters={[
          { id: "command", label: componentText("component.command"), value: "bun test" },
        ]}
      />
      <CodeBlock code="const ready = true;" language="typescript" />
      <ToolResult tool="bash" title="bun test" status="success" defaultOpen>
        <ToolResultOutput>{"2 tests passed"}</ToolResultOutput>
      </ToolResult>
      <TodoList
        defaultOpen
        items={[
          { id: "theme", title: componentText("component.theme"), status: "completed" },
          { id: "keyboard", title: componentText("component.keyboard"), status: "in-progress" },
        ]}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={[
          {
            id: "project",
            label: componentText("component.open-project"),
            onSelect: () => setResult(componentText("component.open-project")),
          },
        ]}
      />
    </main>
  );
}
