// PROTOTYPE stand-in for @rukie/i18n: interface copy only; fake Transcript content stays as data.
import { createContext, useContext } from "react";

export type Lang = "zh" | "en";

const zh = {
  appName: "Rukie",
  newSession: "新会话",
  addProject: "添加项目",
  projects: "项目",
  sessions: "会话",
  search: "搜索会话",
  placeholder: "描述任务，Enter 发送，Shift+Enter 换行",
  send: "发送",
  stop: "停止",
  steer: "补充说明",
  mode: "权限模式",
  "mode.ask": "每次询问",
  "mode.auto-review": "自动审查",
  "mode.full-access": "完全访问",
  permissionTitle: "{tool} 需要你的确认",
  allow: "允许",
  allowSession: "本会话内允许",
  deny: "拒绝",
  allowed: "已允许",
  allowedSession: "已允许（本会话内）",
  denied: "已拒绝",
  "tool.running": "执行中",
  "tool.done": "完成",
  "tool.error": "失败",
  connected: "已连接",
  reconnecting: "正在重新连接…",
  disconnected: "连接已断开",
  disconnectedHint: "Run 仍在 sidecar 中继续；重连后补齐消息并重新显示待确认项。",
  retry: "重试",
  steps: "执行了 {n} 步",
  running: "正在执行",
  waiting: "等待确认",
  idle: "空闲",
  inspector: "检查器",
  pending: "待处理",
  noSelection: "选择一个工具调用查看输出",
  output: "输出",
  toggleSidebar: "切换侧栏",
  toggleInspector: "切换检查器",
  reason: "原因",
  selectSession: "切换会话",
};

const en: Record<keyof typeof zh, string> = {
  appName: "Rukie",
  newSession: "New session",
  addProject: "Add project",
  projects: "Projects",
  sessions: "Sessions",
  search: "Search sessions",
  placeholder: "Describe a task. Enter to send, Shift+Enter for a new line",
  send: "Send",
  stop: "Stop",
  steer: "Add guidance",
  mode: "Permission mode",
  "mode.ask": "Ask every time",
  "mode.auto-review": "Auto review",
  "mode.full-access": "Full access",
  permissionTitle: "{tool} needs your approval",
  allow: "Allow",
  allowSession: "Allow for this session",
  deny: "Deny",
  allowed: "Allowed",
  allowedSession: "Allowed for this session",
  denied: "Denied",
  "tool.running": "Running",
  "tool.done": "Done",
  "tool.error": "Failed",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
  disconnectedHint: "The Run keeps going in the sidecar. Messages and pending approvals return after reconnecting.",
  retry: "Retry",
  steps: "{n} steps",
  running: "Running",
  waiting: "Waiting for approval",
  idle: "Idle",
  inspector: "Inspector",
  pending: "Pending",
  noSelection: "Select a tool call to see its output",
  output: "Output",
  toggleSidebar: "Toggle sidebar",
  toggleInspector: "Toggle inspector",
  reason: "Reason",
  selectSession: "Switch session",
};

export type MessageKey = keyof typeof zh;

export const LangContext = createContext<Lang>("zh");

export function useT() {
  const lang = useContext(LangContext);
  const dict = lang === "zh" ? zh : en;
  return (key: MessageKey, vars: Record<string, string | number> = {}) =>
    dict[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}
