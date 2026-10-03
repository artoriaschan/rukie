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
      return new Promise((resolve) => {
        const abort = () => item.finish("deny");
        const item: Extract<PendingInteraction, { kind: "permission" }> = {
          kind: "permission",
          interaction: { kind: "permission", request, selected: 0 },
          finish(decision: "allow" | "deny") {
            request.signal.removeEventListener("abort", abort);
            const index = pending.indexOf(item);
            if (index === -1) return;
            pending.splice(index, 1);
            resolve(request.signal.aborted ? "deny" : decision);
            notify();
          },
        };
        request.signal.addEventListener("abort", abort, { once: true });
        pending.push(item);
        notify();
      });
    },
    askQuestion(request: QuestionRequest): Promise<QuestionReply> {
      if (request.signal.aborted) return Promise.resolve("declined");
      return new Promise((resolve) => {
        const abort = () => item.finish("declined");
        const item: Extract<PendingInteraction, { kind: "question" }> = {
          kind: "question",
          interaction: { kind: "question", request, selected: 0 },
          finish(reply) {
            request.signal.removeEventListener("abort", abort);
            const index = pending.indexOf(item);
            if (index === -1) return;
            pending.splice(index, 1);
            resolve(request.signal.aborted ? "declined" : reply);
            notify();
          },
        };
        request.signal.addEventListener("abort", abort, { once: true });
        pending.push(item);
        notify();
      });
    },
    selectQuestion(selected: number) {
      const item = pending[0];
      if (item?.kind !== "question") return;
      const count = item.interaction.request.questions[0]!.options.length;
      item.interaction = { ...item.interaction, selected: (selected + count) % count };
      notify();
    },
    answerQuestion() {
      const item = pending[0];
      if (!item || item.kind !== "question") return;
      const { request, selected } = item.interaction;
      item.finish({ answers: [{ selected: [request.questions[0]!.options[selected]!.label] }] });
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
