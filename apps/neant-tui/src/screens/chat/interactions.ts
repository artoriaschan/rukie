import type { PermissionAskRequest, QuestionRequest, QuestionReply } from "@neant/agent";
import { permissionChoices } from "../../components/permission-dialog";

interface PermissionInteraction {
  kind: "permission";
  request: PermissionAskRequest;
  selected: number;
}

interface QuestionInteraction {
  kind: "question";
  request: QuestionRequest;
  selected: number;
  checked: number[];
  editing: boolean;
  custom: string;
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
          selected: 0,
          checked: [],
          editing: false,
          custom: "",
        },
        finish,
      }));
    },
    selectQuestion(selected: number) {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const count = item.interaction.request.questions[0]!.options.length + 1;
      item.interaction = { ...item.interaction, selected: (selected + count) % count };
      notify();
    },
    toggleQuestion() {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const { selected, checked, request } = item.interaction;
      if (selected === request.questions[0]!.options.length) {
        item.interaction = { ...item.interaction, editing: true };
        notify();
        return;
      }
      item.interaction = {
        ...item.interaction,
        checked: checked.includes(selected)
          ? checked.filter((index) => index !== selected)
          : request.questions[0]!.multiSelect
            ? [...checked, selected]
            : [selected],
      };
      notify();
    },
    changeQuestionCustom(custom: string) {
      const item = pending[0];
      if (item?.kind !== "question") return;
      item.interaction = { ...item.interaction, custom: custom.replace(/[\r\n]+/g, " ") };
      notify();
    },
    answerQuestion() {
      const item = pending[0];
      if (!item || item.kind !== "question") return;
      const { request, selected, checked, editing, custom } = item.interaction;
      const question = request.questions[0]!;
      if (selected === question.options.length && !editing) {
        item.interaction = { ...item.interaction, editing: true };
        notify();
        return;
      }
      const indices = question.multiSelect || editing ? checked : [selected];
      item.finish({
        answers: [
          {
            selected: question.options
              .filter((_, index) => indices.includes(index))
              .map(({ label }) => label),
            ...(custom ? { custom } : {}),
          },
        ],
      });
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
