import type { PermissionAskRequest } from "@neant/agent";
import { permissionChoices } from "../../components/permission-dialog/permission-dialog";

interface Question {
  request: PermissionAskRequest;
  selected: number;
}

/** Keep pending questions outside React so each key sees the latest decision. */
export function createPermissions() {
  const allowed = new Set<string>();
  const pending: { question: Question; finish(decision: "allow" | "deny"): void }[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    getSnapshot: () => pending[0]?.question,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ask(request: PermissionAskRequest): Promise<"allow" | "deny"> {
      if (request.signal.aborted) return Promise.resolve("deny");
      if (request.mode !== "auto-review" && allowed.has(request.toolName))
        return Promise.resolve("allow");
      return new Promise((resolve) => {
        const abort = () => item.finish("deny");
        const item = {
          question: { request, selected: 0 },
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
    select(selected: number) {
      const item = pending[0];
      if (!item) return;
      const count = permissionChoices(item.question.request.mode).length;
      item.question = { ...item.question, selected: (selected + count) % count };
      notify();
    },
    confirm() {
      const item = pending[0];
      if (!item) return;
      const { request, selected } = item.question;
      const decision = permissionChoices(request.mode)[selected]!.decision;
      if (decision === "allow-tool" && !request.signal.aborted) {
        allowed.add(request.toolName);
        // pi can ask for several tool calls concurrently, including the same tool.
        for (const queued of pending.filter(
          (queued) =>
            queued.question.request.mode !== "auto-review" &&
            queued.question.request.toolName === request.toolName,
        )) {
          queued.finish("allow");
        }
      } else item.finish(decision === "allow" ? "allow" : "deny");
    },
    deny() {
      pending[0]?.finish("deny");
    },
  };
}
