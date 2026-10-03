import type { PermissionAskRequest } from "@neant/agent";
import { permissionChoices } from "../../components/permission-dialog/permission-dialog";

interface PermissionInteraction {
  kind: "permission";
  request: PermissionAskRequest;
  selected: number;
}

type Interaction = PermissionInteraction;

interface PendingInteraction {
  interaction: Interaction;
  finish(decision: "allow" | "deny"): void;
}

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
        const item: PendingInteraction = {
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
    selectPermission(selected: number) {
      const item = pending[0];
      if (item?.interaction.kind !== "permission") return;
      const count = permissionChoices(item.interaction.request.mode).length;
      item.interaction = { ...item.interaction, selected: (selected + count) % count };
      notify();
    },
    confirmPermission() {
      const item = pending[0];
      if (item?.interaction.kind !== "permission") return;
      const { request, selected } = item.interaction;
      const decision = permissionChoices(request.mode)[selected]!.decision;
      if (decision === "allow-tool" && !request.signal.aborted) {
        allowed.add(request.toolName);
        // pi can ask for several tool calls concurrently, including the same tool.
        for (const queued of pending.filter(
          (queued) =>
            queued.interaction.kind === "permission" &&
            queued.interaction.request.mode !== "auto-review" &&
            queued.interaction.request.toolName === request.toolName,
        )) {
          queued.finish("allow");
        }
      } else item.finish(decision === "allow" ? "allow" : "deny");
    },
    denyPermission() {
      const item = pending[0];
      if (item?.interaction.kind === "permission") item.finish("deny");
    },
  };
}
