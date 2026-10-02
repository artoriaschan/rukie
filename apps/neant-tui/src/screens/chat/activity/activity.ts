import type { SessionEvent } from "@neant/agent";
import {
  ACTION_MAP,
  APPROVAL_PHRASES,
  COMPACT_PHRASES,
  CONTINUE_PHRASES,
  FAIL_PHRASES,
  FALLBACK_ACTIONS,
  TOOL_OPENING_PHRASES,
  DONE_PHRASES,
  WAITING_PHRASES,
  RARE_CHANCE,
  RARE_PHRASES,
  WEEKEND_PHRASES,
  fmtDuration,
  holidayPhrase,
  mixSlot,
  pickPhrase,
  pickPhraseAt,
  thinkingPhrase,
} from "./phrases";
import { detailFor, extractNarration, sanitizeFragment } from "./text";

type Phase = "idle" | "waiting" | "thinking" | "tool" | "done";
type ActivityEvent =
  | SessionEvent
  | { type: "submit" | "interrupt" | "approval-open" | "approval-close" }
  | { type: "git-branch"; branch: string };

interface ActivityState {
  phase: Phase;
  runStartedAt: number;
  phaseStartedAt: number;
  thinkingMs: number;
  toolMs: number;
  toolCount: number;
  tokens: number;
  thinkingPhases: number;
  donePrefix: string;
  tools: readonly ActiveTool[];
  firstToolStartedAt?: number;
  lastTool?: ActiveTool & { endedAt: number; failure?: string };
  streak: number;
  streamLine: string;
  narration?: string;
  lastChunkAt?: number;
  pending?: { line: string; until: number };
  interrupted: boolean;
  approvalStartedAt?: number;
  gitBranch?: string;
}

interface ActiveTool {
  id: string;
  action: string;
  detail: string;
  startedAt: number;
}

export function createActivity(): ActivityState {
  return {
    phase: "idle",
    runStartedAt: 0,
    phaseStartedAt: 0,
    thinkingMs: 0,
    toolMs: 0,
    toolCount: 0,
    tokens: 0,
    thinkingPhases: 0,
    donePrefix: "",
    tools: [],
    streak: 0,
    streamLine: "",
    interrupted: false,
  };
}

function transition(state: ActivityState, phase: Phase, now: number): ActivityState {
  if (state.phase === phase) return state;
  const elapsed = now - state.phaseStartedAt;
  return {
    ...state,
    phase,
    phaseStartedAt: now,
    thinkingMs: state.thinkingMs + (state.phase === "thinking" ? elapsed : 0),
    toolMs: state.toolMs + (state.phase === "tool" ? elapsed : 0),
    thinkingPhases: state.thinkingPhases + (phase === "thinking" ? 1 : 0),
  };
}

export function reduce(
  state: ActivityState,
  event: ActivityEvent,
  now: number,
  random = Math.random,
): ActivityState {
  if (event.type === "git-branch")
    return { ...state, gitBranch: sanitizeFragment(event.branch) || undefined };
  if (event.type === "submit")
    return {
      ...createActivity(),
      phase: "waiting",
      runStartedAt: now,
      phaseStartedAt: now,
      gitBranch: state.gitBranch,
    };
  // Events arriving after a result cannot revive or change a completed Run.
  if (state.phase === "idle" || state.phase === "done") return state;
  switch (event.type) {
    case "turn_start":
      return { ...state, streamLine: "", narration: undefined, lastChunkAt: undefined };
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update.type !== "text_delta" && update.type !== "thinking_delta") return state;
      let next = state.phase === "waiting" ? transition(state, "thinking", now) : state;
      next = { ...next, lastChunkAt: now };
      if (update.type === "text_delta") {
        let line = next.streamLine;
        let narration = next.narration;
        const chunks = update.delta.split("\n");
        for (const [index, chunk] of chunks.entries()) {
          if (index > 0) line = "";
          // Only a line prefix is needed; bound memory without inventing line starts.
          line = (line + chunk).slice(0, 1024);
          narration = extractNarration(line) ?? narration;
        }
        next = { ...next, streamLine: line, narration };
      }
      return next;
    }
    case "approval-open":
      return { ...state, approvalStartedAt: state.approvalStartedAt ?? now };
    case "approval-close":
      return { ...state, approvalStartedAt: undefined };
    case "interrupt":
      return {
        ...state,
        interrupted: true,
        pending: { line: pickPhrase(CONTINUE_PHRASES, random), until: now + 6000 },
      };
    case "compaction":
      return {
        ...state,
        pending: { line: pickPhrase(COMPACT_PHRASES, random), until: now + 6000 },
      };
    case "tool_execution_start": {
      if (state.tools.some((tool) => tool.id === event.toolCallId)) return state;
      const actions =
        ACTION_MAP.find(({ test }) => test.test(event.toolName.trim()))?.actions ??
        FALLBACK_ACTIONS;
      const tool = {
        id: event.toolCallId,
        action: pickPhrase(actions, random),
        detail: detailFor(event.args),
        startedAt: now,
      };
      const close =
        state.tools.length > 0 ||
        (state.lastTool !== undefined && now - state.lastTool.endedAt <= 10_000);
      return {
        ...transition(state, "tool", now),
        tools: [...state.tools, tool],
        toolCount: state.toolCount + 1,
        firstToolStartedAt: state.firstToolStartedAt ?? now,
        streak: close ? state.streak + 1 : 1,
      };
    }
    case "tool_execution_end": {
      const tool = state.tools.find((tool) => tool.id === event.toolCallId);
      if (!tool) return state;
      const tools = state.tools.filter((tool) => tool.id !== event.toolCallId);
      return {
        ...transition(state, tools.length ? "tool" : "thinking", now),
        tools,
        lastTool: {
          ...tool,
          endedAt: now,
          failure: event.isError ? pickPhrase(FAIL_PHRASES, random) : undefined,
        },
      };
    }
    case "result":
      return {
        ...transition(state, "done", now),
        tools: [],
        approvalStartedAt: undefined,
        tokens: event.usage.totalTokens,
        donePrefix: pickPhrase(event.success ? DONE_PHRASES : FAIL_PHRASES, random),
        pending:
          !event.success && state.interrupted
            ? { line: pickPhrase(CONTINUE_PHRASES, random), until: now + 6000 }
            : undefined,
      };
    default:
      return state;
  }
}

export function render(state: ActivityState, now: number) {
  if (state.phase === "idle") return { phase: state.phase, line: "", nextWakeAt: undefined };
  const pending = state.pending && now < state.pending.until ? state.pending : undefined;
  const git = state.gitBranch ? ` · git ${state.gitBranch}` : "";
  if (state.phase === "done") {
    const tokens = state.tokens > 0 ? ` · 🔥 ${fmtTokens(state.tokens)}` : "";
    const summary = `${state.donePrefix} · ${state.toolCount} 工具 · 想${fmtDuration(state.thinkingMs)} 干${fmtDuration(state.toolMs)}${tokens}`;
    return {
      phase: state.phase,
      line: `${pending ? `${pending.line} · ${summary}` : summary}${git}`,
      nextWakeAt: pending?.until,
    };
  }
  const elapsed = Math.max(0, now - state.phaseStartedAt);
  const rare =
    state.phase === "thinking" &&
    state.thinkingPhases === 1 &&
    mixSlot(state.runStartedAt, 0x5eed) % Math.round(1 / RARE_CHANCE) === 0;
  const rotation = rare ? 7500 : 4000;
  const slot = Math.floor(elapsed / rotation);
  // Freeze both the tier and calendar pool for the complete rotation window.
  const date = new Date(state.phaseStartedAt + slot * rotation);
  let phrase = pickPhraseAt(WAITING_PHRASES, state.runStartedAt, slot);
  if (state.phase === "thinking") {
    const holiday =
      state.thinkingPhases === 1 && slot === 0
        ? holidayPhrase(date, state.runStartedAt, slot)
        : undefined;
    phrase =
      holiday ??
      (rare
        ? pickPhraseAt(RARE_PHRASES, state.runStartedAt, slot)
        : state.thinkingPhases === 1 && slot === 0 && [0, 6].includes(date.getDay())
          ? pickPhraseAt(WEEKEND_PHRASES, state.runStartedAt, slot)
          : thinkingPhrase(slot * rotation, state.runStartedAt, slot, date.getHours() < 6));
  }
  const tool = state.tools.at(-1);
  const openingUntil =
    state.firstToolStartedAt === undefined ? undefined : state.firstToolStartedAt + 2500;
  const opening =
    openingUntil !== undefined && now < openingUntil
      ? `${pickPhraseAt(TOOL_OPENING_PHRASES, state.runStartedAt, 0)} · `
      : "";
  const combo = state.streak >= 2 ? ` · 工具x${state.streak}` : "";
  if (state.phase === "tool" && tool) {
    phrase = `${opening}${toolFragment(tool)} · ${fmtDuration(now - tool.startedAt)}${combo}`;
  } else if (state.phase === "thinking" && state.lastTool && now < state.lastTool.endedAt + 2500) {
    const last = state.lastTool;
    const duration = last.endedAt - last.startedAt;
    phrase = `${last.failure ? `✗ ${last.failure} · ` : "✓ "}${toolFragment(last)} · ${duration < 1000 ? `${duration}ms` : fmtDuration(duration)}${combo}`;
  }
  const narrationUntil = state.lastChunkAt === undefined ? undefined : state.lastChunkAt + 5000;
  if (state.narration && narrationUntil !== undefined && now < narrationUntil) {
    phrase = `⏵ ${state.narration}${state.phase === "tool" ? ` · ${phrase}` : ""}`;
  }
  if (pending) phrase = pending.line;
  if (state.approvalStartedAt !== undefined)
    phrase = pickPhraseAt(APPROVAL_PHRASES, state.runStartedAt + state.approvalStartedAt, 0);
  const candidates = [
    nextBoundary(state.runStartedAt, now, 1000),
    state.phase === "tool" && tool ? nextBoundary(tool.startedAt, now, 1000) : undefined,
    state.phase !== "tool" ? nextBoundary(state.phaseStartedAt, now, rotation) : undefined,
    openingUntil,
    state.lastTool ? state.lastTool.endedAt + 2500 : undefined,
    state.narration ? narrationUntil : undefined,
    pending?.until,
  ];
  const deadlines = candidates.filter((at): at is number => at !== undefined && at > now);
  return {
    phase: state.phase,
    line: `${phrase} · 总${fmtDuration(now - state.runStartedAt)}${git}`,
    nextWakeAt: Math.min(...deadlines),
  };
}

function toolFragment(tool: ActiveTool): string {
  return `${tool.action}${tool.detail ? ` ${tool.detail}` : ""}`;
}

function nextBoundary(anchor: number, now: number, interval: number): number {
  return anchor + (Math.floor(Math.max(0, now - anchor) / interval) + 1) * interval;
}

export function fmtTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}
