import type { PermissionAskRequest, QuestionRequest, QuestionReply } from "@neant/agent";
import { readClipboardText } from "./clipboard";
import type { InputEvent } from "@neant/tui";
import { permissionChoices } from "../../components/permission-dialog";

interface PermissionInteraction {
  kind: "permission";
  request: PermissionAskRequest;
  selected: number;
}

interface QuestionDraft {
  selected: number;
  checked: number[];
  cursor: number;
  attached?: number;
  error?: "select" | "custom" | "paste" | "clipboard";
  custom: string;
  answer?: Exclude<QuestionReply, "declined">["answers"][number];
}

interface QuestionInteraction {
  kind: "question";
  request: QuestionRequest;
  questionIndex: number;
  drafts: QuestionDraft[];
  collapsed: boolean;
}

const answerSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type PendingInteraction =
  | {
      kind: "permission";
      interaction: PermissionInteraction;
      finish(decision: "allow" | "deny"): void;
    }
  | { kind: "question"; interaction: QuestionInteraction; finish(reply: QuestionReply): void };

/** Keep the Interaction FIFO outside React so each key sees the latest request. */
export function createInteractions() {
  const allowed = new Set<string>();
  const pending: PendingInteraction[] = [];
  const listeners = new Set<() => void>();
  let clipboardBusy: symbol | undefined;
  let clipboardOwner: PendingInteraction | undefined;
  let questionGeneration = 0;
  const notify = () => listeners.forEach((listener) => listener());
  const enqueue = <Reply>(
    signal: AbortSignal,
    cancelled: Reply,
    createItem: (finish: (reply: Reply) => void) => PendingInteraction,
  ): Promise<Reply> => {
    if (signal.aborted) return Promise.resolve(cancelled);
    return new Promise((resolve) => {
      const finish = (reply: Reply) => {
        signal.removeEventListener("abort", abort);
        const index = pending.indexOf(item);
        if (index === -1) return;
        pending.splice(index, 1);
        resolve(signal.aborted ? cancelled : reply);
        notify();
      };
      const abort = () => finish(cancelled);
      const item = createItem(finish);
      signal.addEventListener("abort", abort, { once: true });
      pending.push(item);
      notify();
    });
  };
  const updateQuestion = (update: (draft: QuestionDraft) => QuestionDraft) => {
    const item = pending[0];
    if (item?.kind !== "question") return;
    const { questionIndex, drafts } = item.interaction;
    item.interaction = {
      ...item.interaction,
      drafts: drafts.map((draft, index) => (index === questionIndex ? update(draft) : draft)),
    };
    notify();
  };
  return {
    getSnapshot: () => pending[0]?.interaction,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    askPermission(request: PermissionAskRequest): Promise<"allow" | "deny"> {
      if (request.signal.aborted) return Promise.resolve("deny");
      if (request.mode !== "auto-review" && allowed.has(request.toolName))
        return Promise.resolve("allow");
      return enqueue<"allow" | "deny">(request.signal, "deny", (finish) => ({
        kind: "permission",
        interaction: { kind: "permission", request, selected: 0 },
        finish,
      }));
    },
    askQuestion(request: QuestionRequest): Promise<QuestionReply> {
      return enqueue<QuestionReply>(request.signal, "declined", (finish) => ({
        kind: "question",
        interaction: {
          kind: "question",
          request,
          questionIndex: 0,
          collapsed: false,
          drafts: request.questions.map(() => ({
            selected: 0,
            checked: [],
            cursor: 0,
            custom: "",
          })),
        },
        finish,
      }));
    },
    switchQuestion(offset: number) {
      const item = pending[0];
      if (item?.kind !== "question") return;
      questionGeneration++;
      clipboardBusy = undefined;
      item.interaction = {
        ...item.interaction,
        questionIndex: Math.max(
          0,
          Math.min(
            item.interaction.request.questions.length - 1,
            item.interaction.questionIndex + offset,
          ),
        ),
      };
      notify();
    },
    toggleQuestionFold() {
      const item = pending[0];
      if (item?.kind !== "question") return;
      item.interaction = { ...item.interaction, collapsed: !item.interaction.collapsed };
      notify();
    },
    selectQuestion(selected: number) {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const count =
        item.interaction.request.questions[item.interaction.questionIndex]!.options.length + 1;
      updateQuestion((draft) => ({
        ...draft,
        selected: (selected + count) % count,
        error: undefined,
      }));
    },
    toggleQuestion(selected?: number) {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const question = item.interaction.request.questions[item.interaction.questionIndex]!;
      if (!question.multiSelect) return;
      updateQuestion((draft) => {
        const index = selected ?? draft.selected;
        if (index >= question.options.length) return draft;
        return {
          ...draft,
          answer: undefined,
          error: undefined,
          checked: draft.checked.includes(index)
            ? draft.checked.filter((value) => value !== index)
            : [...draft.checked, index],
        };
      });
    },
    answerQuestion(selected?: number) {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const { request, questionIndex, drafts } = item.interaction;
      const draft = drafts[questionIndex]!;
      const focus = selected ?? draft.selected;
      const question = request.questions[questionIndex]!;
      const custom = draft.custom.trim();
      const inputFocused = focus === question.options.length;
      const indices = question.multiSelect
        ? draft.checked
        : inputFocused
          ? draft.attached === undefined
            ? []
            : [draft.attached]
          : [focus];
      if (!indices.length && !custom) {
        updateQuestion((value) => ({
          ...value,
          error: question.multiSelect ? "select" : "custom",
        }));
        return;
      }
      const answer = {
        selected: question.options
          .filter((_, index) => indices.includes(index))
          .map(({ label }) => label),
        ...(custom ? { custom } : {}),
      };
      const nextDrafts = drafts.map((value, index) =>
        index === questionIndex ? { ...value, answer, error: undefined } : value,
      );
      const unanswered = nextDrafts.findIndex((value) => !value.answer);
      if (questionIndex === request.questions.length - 1 && unanswered === -1) {
        item.finish({ answers: nextDrafts.map((value) => value.answer!) });
        return;
      }
      questionGeneration++;
      clipboardBusy = undefined;
      item.interaction = {
        ...item.interaction,
        drafts: nextDrafts,
        questionIndex:
          questionIndex === request.questions.length - 1 ? unanswered : questionIndex + 1,
      };
      notify();
    },
    questionInput(event: InputEvent, pasteAtCaret?: boolean) {
      const item = pending[0];
      if (item?.kind !== "question" || (event.type !== "key" && event.type !== "paste")) return;
      const live = item.interaction;
      const current = live.drafts[live.questionIndex]!;
      const question = live.request.questions[live.questionIndex]!;
      if (event.type === "key") {
        const { key } = event;
        if (key.ctrl && key.name === "k" && !key.alt && !key.shift) {
          this.toggleQuestionFold();
          return;
        }
        if (live.collapsed) {
          if (key.name === "escape" || (key.ctrl && key.name === "c")) this.toggleQuestionFold();
          return;
        }
        if (key.ctrl && key.name === "c") {
          item.finish("declined");
          return;
        }
        if (key.name === "escape") {
          if (live.questionIndex > 0) this.switchQuestion(-1);
          else item.finish("declined");
          return;
        }
        if (key.name.toLowerCase() === "v" && (key.ctrl || key.alt) && !key.shift) {
          if (clipboardBusy && clipboardOwner === item) return;
          const pasteToken = Symbol();
          clipboardBusy = pasteToken;
          clipboardOwner = item;
          const atCaret = current.selected === question.options.length;
          const generation = questionGeneration;
          // Ignore results after answering, switching question or folding the panel.
          const questionIndex = live.questionIndex;
          void readClipboardText()
            .then((text) => {
              if (
                pending[0] !== item ||
                item.interaction.questionIndex !== questionIndex ||
                generation !== questionGeneration
              )
                return;
              if (!text?.trim()) updateQuestion((draft) => ({ ...draft, error: "clipboard" }));
              else this.questionInput({ type: "paste", input: text }, atCaret);
            })
            .finally(() => {
              if (clipboardBusy === pasteToken) clipboardBusy = undefined;
            });
          return;
        }
        if (
          (key.ctrl || key.alt) &&
          !(current.selected === question.options.length && ["left", "right"].includes(key.name))
        )
          return;
        if (key.name === "enter" && !key.shift) {
          this.answerQuestion();
          return;
        }
        if (key.name === "tab") {
          this.selectQuestion(question.options.length);
          return;
        }
        if (key.name === "up" || key.name === "down") {
          this.selectQuestion(current.selected + (key.name === "up" ? -1 : 1));
          return;
        }
        if (current.selected < question.options.length) {
          if (!key.shift && (key.name === "left" || key.name === "right")) {
            this.switchQuestion(key.name === "left" ? -1 : 1);
            return;
          }
          if (event.input === " " && question.multiSelect) {
            this.toggleQuestion();
            return;
          }
        }
      } else if (live.collapsed && pasteAtCaret === undefined) return;
      const focused =
        event.type === "paste" && pasteAtCaret !== undefined
          ? pasteAtCaret
          : current.selected === question.options.length;
      const boundaries = [
        0,
        ...Array.from(
          answerSegmenter.segment(current.custom),
          ({ index, segment }) => index + segment.length,
        ),
      ];
      const editingKey = event.type === "key" && ["backspace", "delete"].includes(event.key.name);
      if (!focused && event.type === "key" && event.key.name === "delete") return;
      const cursor = focused || editingKey ? current.cursor : current.custom.length;
      const before = boundaries.findLast((value) => value < cursor) ?? 0;
      const after = boundaries.find((value) => value > cursor) ?? current.custom.length;
      if (event.type === "key") {
        const { key } = event;
        if (["left", "right", "home", "end"].includes(key.name)) {
          if (!focused) return;
          if (
            !key.shift &&
            !key.ctrl &&
            !key.alt &&
            ((key.name === "left" && cursor === 0) ||
              (key.name === "right" && cursor === current.custom.length))
          ) {
            this.switchQuestion(key.name === "left" ? -1 : 1);
            return;
          }
          updateQuestion((draft) => ({
            ...draft,
            cursor:
              key.name === "home"
                ? 0
                : key.name === "end"
                  ? draft.custom.length
                  : key.name === "left"
                    ? before
                    : after,
          }));
          return;
        }
      }
      const input =
        // oxlint-disable-next-line no-control-regex -- Answer fields flatten pasted control characters.
        event.type === "paste" ? event.input.replace(/[\x00-\x1f\x7f]+/g, " ") : event.input;
      if (event.type === "paste" && !input.trim()) return;
      if (event.type === "paste" && Array.from(input).length > 8000) {
        updateQuestion((draft) => ({ ...draft, error: "paste" }));
        return;
      }
      const backspace = event.type === "key" && event.key.name === "backspace";
      const deletion = event.type === "key" && event.key.name === "delete";
      if (!input && !backspace && !deletion) return;
      const start = backspace ? before : cursor;
      const end = deletion ? after : cursor;
      updateQuestion((draft) => {
        const custom = draft.custom.slice(0, start) + input + draft.custom.slice(end);
        return {
          ...draft,
          answer: undefined,
          error: undefined,
          custom,
          cursor: start + input.length,
          attached: !custom
            ? undefined
            : !focused && !question.multiSelect && input
              ? draft.selected
              : draft.attached,
        };
      });
    },
    selectPermission(selected: number) {
      const item = pending[0];
      if (item?.kind !== "permission") return;
      const count = permissionChoices(item.interaction.request.mode).length;
      item.interaction = { ...item.interaction, selected: (selected + count) % count };
      notify();
    },
    confirmPermission() {
      const item = pending[0];
      if (item?.kind !== "permission") return;
      const { request, selected } = item.interaction;
      const decision = permissionChoices(request.mode)[selected]!.decision;
      if (decision === "allow-tool" && !request.signal.aborted) {
        allowed.add(request.toolName);
        // pi can ask for several tool calls concurrently, including the same tool.
        for (const queued of pending.filter(
          (queued) =>
            queued.kind === "permission" &&
            queued.interaction.request.mode !== "auto-review" &&
            queued.interaction.request.toolName === request.toolName,
        )) {
          if (queued.kind === "permission") queued.finish("allow");
        }
      } else item.finish(decision === "allow" ? "allow" : "deny");
    },
    denyPermission() {
      const item = pending[0];
      if (item?.kind === "permission") item.finish("deny");
    },
  };
}
