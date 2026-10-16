import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditableElement } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { $createParagraphNode, $createTextNode, $getRoot, SKIP_DOM_SELECTION_TAG } from "lexical";
import { type HTMLAttributes, type Ref, useLayoutEffect } from "react";
import { SkillPicker, type SkillPickerProps } from "./skill-picker";
import { SkillTokenNode, $serializePrompt } from "./skill-token";
import { SkillClipboard } from "./skill-clipboard";

interface PromptEditorProps extends HTMLAttributes<HTMLDivElement> {
  skills?: SkillPickerProps["skills"];
  insertionOpen?: SkillPickerProps["insertionOpen"];
  onInsertionOpenChange?: SkillPickerProps["onInsertionOpenChange"];
  insertionActions?: SkillPickerProps["insertionActions"];
  onSkillsOpen?: () => void;
  mcpSnapshot?: import("@rukie/shared").McpSnapshot;
  onMcpOpenChange?: (open: boolean) => void;
  anchorRef: SkillPickerProps["anchorRef"];
  value: string;
  disabled?: boolean;
  placeholder: string;
  editorRef: Ref<HTMLDivElement>;
  onValueChange: (value: string) => void;
}

function DraftPlugin({ value, disabled }: { value: string; disabled?: boolean }) {
  const [editor] = useLexicalComposerContext();
  useLayoutEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  useLayoutEffect(() => {
    if (editor.getEditorState().read(() => $serializePrompt()) === value) return;
    // Controlled draft restoration must not claim focus from another surface.
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        if (value) paragraph.append($createTextNode(value));
        $getRoot().clear().append(paragraph);
      },
      { tag: SKIP_DOM_SELECTION_TAG },
    );
  }, [editor, value]);
  return null;
}

function Editable({
  value,
  disabled,
  placeholder,
  editorRef,
  anchorRef: _anchorRef,
  onPaste,
  onDrop,
  ...props
}: Omit<PromptEditorProps, "onValueChange">) {
  const [editor] = useLexicalComposerContext();
  return (
    <ContentEditableElement
      editor={editor}
      {...props}
      onPasteCapture={(event) => {
        onPaste?.(event);
        if (event.defaultPrevented) event.stopPropagation();
      }}
      onDropCapture={(event) => {
        onDrop?.(event);
        if (event.defaultPrevented) event.stopPropagation();
      }}
      ref={editorRef}
      aria-disabled={disabled || undefined}
      aria-placeholder={placeholder}
      aria-multiline="true"
      data-prompt-editor
      data-empty={!value || undefined}
      data-placeholder={placeholder}
    />
  );
}

export function PromptEditor({
  value,
  disabled,
  placeholder,
  editorRef,
  skills,
  onSkillsOpen,
  mcpSnapshot,
  onMcpOpenChange,
  insertionOpen,
  onInsertionOpenChange,
  insertionActions,
  anchorRef,
  onValueChange,
  onPaste,
  onDrop,
  ...props
}: PromptEditorProps) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "rukie-prompt",
        nodes: [SkillTokenNode],
        editable: !disabled,
        onError: (error) => {
          throw error;
        },
      }}
    >
      <PlainTextPlugin
        contentEditable={
          <Editable
            {...props}
            onPaste={onPaste}
            onDrop={onDrop}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            editorRef={editorRef}
            anchorRef={anchorRef}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <SkillClipboard skills={skills} />
      {(skills || insertionActions) && (
        <SkillPicker
          skills={skills}
          insertionOpen={insertionOpen}
          onInsertionOpenChange={onInsertionOpenChange}
          insertionActions={insertionActions}
          onSkillsOpen={onSkillsOpen}
          mcpSnapshot={mcpSnapshot}
          onMcpOpenChange={onMcpOpenChange}
          anchorRef={anchorRef}
          disabled={disabled}
        />
      )}
      <DraftPlugin value={value} disabled={disabled} />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(state) => {
          const next = state.read(() => $serializePrompt());
          if (next !== value) onValueChange(next);
        }}
      />
    </LexicalComposer>
  );
}
