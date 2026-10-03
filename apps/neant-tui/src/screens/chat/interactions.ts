import type { PermissionAskRequest, QuestionRequest, QuestionReply } from "@neant/agent";
import { permissionChoices } from "../../components/permission-dialog";

interface PermissionInteraction {
  kind: "permission";
  request: PermissionAskRequest;
  selected: number;
}

interface QuestionDraft {
  selected: number;
  checked: number[];
  editing: boolean;
  custom: string;
  answer?: Exclude<QuestionReply, "declined">["answers"][number];
}

interface QuestionInteraction {
  kind: "question";
  request: QuestionRequest;
  questionIndex: number;
  drafts: QuestionDraft[];
}

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
          drafts: request.questions.map(() => ({
            selected: 0,
            checked: [],
            editing: false,
            custom: "",
          })),
        },
        finish,
      }));
    },
    switchQuestion(offset: number) {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const { questionIndex, request } = item.interaction;
      item.interaction = {
        ...item.interaction,
        questionIndex:
          (questionIndex + offset + request.questions.length) % request.questions.length,
      };
      notify();
    },
    selectQuestion(selected: number) {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const count =
        item.interaction.request.questions[item.interaction.questionIndex]!.options.length + 1;
      updateQuestion((draft) => ({ ...draft, selected: (selected + count) % count }));
    },
    toggleQuestion() {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const question = item.interaction.request.questions[item.interaction.questionIndex]!;
      updateQuestion((draft) => {
        const { selected, checked } = draft;
        if (selected === question.options.length) return { ...draft, editing: true };
        return {
          ...draft,
          answer: undefined,
          checked: checked.includes(selected)
            ? checked.filter((index) => index !== selected)
            : question.multiSelect
              ? [...checked, selected]
              : [selected],
        };
      });
    },
    changeQuestionCustom(custom: string) {
      updateQuestion((draft) => ({
        ...draft,
        answer: undefined,
        custom: custom.replace(/[\r\n]+/g, " "),
      }));
    },
    answerQuestion() {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const { request, questionIndex, drafts } = item.interaction;
      const { selected, checked, editing, custom } = drafts[questionIndex]!;
      const question = request.questions[questionIndex]!;
      if (selected === question.options.length && !editing) {
        updateQuestion((draft) => ({ ...draft, editing: true }));
        return;
      }
      const indices = question.multiSelect || editing ? checked : [selected];
      const answer = {
        selected: question.options
          .filter((_, index) => indices.includes(index))
          .map(({ label }) => label),
        ...(custom ? { custom } : {}),
      };
      const nextDrafts = drafts.map((draft, index) =>
        index === questionIndex ? { ...draft, editing: false, checked: indices, answer } : draft,
      );
      const unanswered = nextDrafts.findIndex((draft) => !draft.answer);
      if (questionIndex === request.questions.length - 1 && unanswered === -1) {
        item.finish({ answers: nextDrafts.map((draft) => draft.answer!) });
        return;
      }
      item.interaction = {
        ...item.interaction,
        drafts: nextDrafts,
        questionIndex:
          questionIndex === request.questions.length - 1 ? unanswered : questionIndex + 1,
      };
      notify();
    },
    declineQuestion() {
      const item = pending[0];
      if (item?.kind === "question") item.finish("declined");
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
