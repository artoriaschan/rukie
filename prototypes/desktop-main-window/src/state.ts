// PROTOTYPE in-memory state; no persistence, no server.
import { createContext, useContext } from "react";
import type { Connection, PermissionMode, PermissionReply } from "./data";

/** waiting: live Run blocked on the permission Interaction; idle: no live Run. */
export type RunStatus = "running" | "waiting" | "idle";

export interface ProtoState {
  connection: Connection;
  mode: PermissionMode;
  setMode: (mode: PermissionMode) => void;
  reply: PermissionReply | null;
  answer: (reply: PermissionReply) => void;
  status: RunStatus;
  stop: () => void;
  activeSession: string;
  setActiveSession: (id: string) => void;
  sent: string[];
  send: (text: string) => void;
}

export const ProtoContext = createContext<ProtoState | null>(null);

export function useProto(): ProtoState {
  const value = useContext(ProtoContext);
  if (!value) throw new Error("ProtoContext missing");
  return value;
}
