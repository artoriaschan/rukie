// PROTOTYPE in-memory state; no persistence, no server.
import { createContext, useContext } from "react";
import type { Connection, PermissionMode, PermissionReply, SessionItem } from "./data";

/** waiting: live Run blocked on the permission Interaction; idle: no live Run. */
export type RunStatus = "running" | "waiting" | "idle";

/** new: the welcome page for a not-yet-created Session in a project or the default workspace. */
export type Selection = { kind: "new"; projectId: string | null } | { kind: "session"; id: string };

export interface ProtoState {
  connection: Connection;
  mode: PermissionMode;
  setMode: (mode: PermissionMode) => void;
  sessions: SessionItem[];
  selection: Selection;
  select: (selection: Selection) => void;
  togglePin: (id: string) => void;
  /** Run status of a Session. Only s1 and Sessions created in this page are ever live. */
  statusOf: (id: string) => RunStatus;
  reply: PermissionReply | null;
  answer: (reply: PermissionReply) => void;
  stop: (id: string) => void;
  sentOf: (id: string) => string[];
  /** Sends from the current selection; from the welcome page this creates the Session first. */
  send: (text: string) => void;
}

export const ProtoContext = createContext<ProtoState | null>(null);

export function useProto(): ProtoState {
  const value = useContext(ProtoContext);
  if (!value) throw new Error("ProtoContext missing");
  return value;
}
