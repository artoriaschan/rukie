import type { SessionEvent } from "@rukie/agent";
import { fmtDuration, type Locale } from "@rukie/i18n";
import { createTuiI18n } from "../../i18n";
import {
  activityPhrases,
  RARE_CHANCE,
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
  locale: Locale;
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
  reviews: readonly { id: string; startedAt: number }[];
  firstToolStartedAt?: number;
  lastTool?: ActiveTool & { endedAt: number; failure?: string };
  streak: number;
  streamLine: string;
  narration?: string;
  lastChunkAt?: number;
  pending?: { line: string; until: number };
  interrupted: boolean;
  approvalStartedAt?: number;
  compactionStartedAt?: number;
  gitBranch?: string;
}

interface ActiveTool {
  id: string;
  action: string;
  detail: string;
  startedAt: number;
}

export function createActivity(locale: Locale = "zh"): ActivityState {
  return {
    locale,
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
    reviews: [],
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
  const pools = activityPhrases(state.locale);
  if (event.type === "git-branch")
    return { ...state, gitBranch: sanitizeFragment(event.branch) || undefined };
  if (event.type === "submit")
    return {
      ...createActivity(state.locale),
      phase: "waiting",
      runStartedAt: now,
      phaseStartedAt: now,
      gitBranch: state.gitBranch,
    };
  // Events arriving after a result cannot revive or change a completed Run.
  if (state.phase === "idle" || state.phase === "done") return state;
  switch (event.type) {
    case "message_start":
      return { ...state, compactionStartedAt: undefined };
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
    case "permission_review":
      return {
        ...state,
        reviews:
          event.phase === "start"
            ? state.reviews.some((review) => review.id === event.toolCallId)
              ? state.reviews
              : [...state.reviews, { id: event.toolCallId, startedAt: now }]
            : state.reviews.filter((review) => review.id !== event.toolCallId),
      };
    case "interrupt":
      return {
        ...state,
        interrupted: true,
        reviews: [],
        compactionStartedAt: undefined,
        pending: { line: pickPhrase(pools.CONTINUE_PHRASES, random), until: now + 6000 },
      };
    case "compaction_start":
      return { ...state, compactionStartedAt: state.compactionStartedAt ?? now };
    case "compaction_end":
      return {
        ...state,
        compactionStartedAt: undefined,
        pending: {
          line: `${pickPhrase(pools.COMPACT_PHRASES, random)} · ${fmtTokens(event.tokensBefore)}→${fmtTokens(event.tokensAfter)}`,
          until: now + 6000,
        },
      };
    case "tool_execution_start": {
      if (state.tools.some((tool) => tool.id === event.toolCallId)) return state;
      const actions =
        pools.ACTION_MAP.find(({ test }) => test.test(event.toolName.trim()))?.actions ??
        pools.FALLBACK_ACTIONS;
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
          failure: event.isError ? pickPhrase(pools.FAIL_PHRASES, random) : undefined,
        },
      };
    }
    case "result":
      return {
        ...transition(state, "done", now),
        tools: [],
        reviews: [],
        approvalStartedAt: undefined,
        compactionStartedAt: undefined,
        tokens: event.usage.totalTokens,
        donePrefix: pickPhrase(event.success ? pools.DONE_PHRASES : pools.FAIL_PHRASES, random),
        pending:
          !event.success && state.interrupted
            ? { line: pickPhrase(pools.CONTINUE_PHRASES, random), until: now + 6000 }
            : undefined,
      };
    default:
      return state;
  }
}

export function render(state: ActivityState, now: number) {
  const pools = activityPhrases(state.locale);
  const t = createTuiI18n(state.locale);
  if (state.phase === "idle") return { phase: state.phase, line: "", nextWakeAt: undefined };
  const pending = state.pending && now < state.pending.until ? state.pending : undefined;
  const git = state.gitBranch ? ` · git ${state.gitBranch}` : "";
  if (state.phase === "done") {
    const tokens = state.tokens > 0 ? ` · 🔥 ${fmtTokens(state.tokens)}` : "";
    const tools = t(state.toolCount === 1 ? "tool-count-one" : "tool-count-many", {
      count: state.toolCount,
    });
    const summary = `${state.donePrefix} · ${t("done-summary", { tools, thinking: fmtDuration(state.thinkingMs, state.locale), tooling: fmtDuration(state.toolMs, state.locale) })}${tokens}`;
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
  let phrase = pickPhraseAt(pools.WAITING_PHRASES, state.runStartedAt, slot);
  if (state.phase === "thinking") {
    const holiday =
      state.thinkingPhases === 1 && slot === 0
        ? holidayPhrase(date, state.runStartedAt, slot, state.locale)
        : undefined;
    phrase =
      holiday ??
      (rare
        ? pickPhraseAt(pools.RARE_PHRASES, state.runStartedAt, slot)
        : state.thinkingPhases === 1 && slot === 0 && [0, 6].includes(date.getDay())
          ? pickPhraseAt(pools.WEEKEND_PHRASES, state.runStartedAt, slot)
          : thinkingPhrase(
              slot * rotation,
              state.runStartedAt,
              slot,
              date.getHours() < 6,
              state.locale,
            ));
  }
  const tool = state.tools.at(-1);
  const openingUntil =
    state.firstToolStartedAt === undefined ? undefined : state.firstToolStartedAt + 2500;
  const opening =
    openingUntil !== undefined && now < openingUntil
      ? `${pickPhraseAt(pools.TOOL_OPENING_PHRASES, state.runStartedAt, 0)} · `
      : "";
  const combo = state.streak >= 2 ? ` · ${t("tool-streak", { count: state.streak })}` : "";
  if (state.phase === "tool" && tool) {
    phrase = `${opening}${toolFragment(tool)} · ${fmtDuration(now - tool.startedAt, state.locale)}${combo}`;
  } else if (state.phase === "thinking" && state.lastTool && now < state.lastTool.endedAt + 2500) {
    const last = state.lastTool;
    const duration = last.endedAt - last.startedAt;
    phrase = `${last.failure ? `✗ ${last.failure} · ` : "✓ "}${toolFragment(last)} · ${duration < 1000 ? `${duration}ms` : fmtDuration(duration, state.locale)}${combo}`;
  }
  const narrationUntil = state.lastChunkAt === undefined ? undefined : state.lastChunkAt + 5000;
  if (state.narration && narrationUntil !== undefined && now < narrationUntil) {
    phrase = `⏵ ${state.narration}${state.phase === "tool" ? ` · ${phrase}` : ""}`;
  }
  if (pending) phrase = pending.line;
  if (state.compactionStartedAt !== undefined)
    phrase = pickPhraseAt(
      pools.COMPACTION_START_PHRASES,
      state.runStartedAt + state.compactionStartedAt,
      0,
    );
  const review = state.reviews[0];
  if (review)
    phrase = pickPhraseAt(
      pools.REVIEW_PHRASES,
      state.runStartedAt + review.startedAt,
      Math.floor(Math.max(0, now - review.startedAt) / 4000),
    );
  if (state.approvalStartedAt !== undefined)
    phrase = pickPhraseAt(pools.APPROVAL_PHRASES, state.runStartedAt + state.approvalStartedAt, 0);
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
    phase: review && state.approvalStartedAt === undefined ? ("review" as const) : state.phase,
    line: `${phrase} · ${t("line-elapsed", { elapsed: fmtDuration(now - state.runStartedAt, state.locale) })}${git}`,
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
