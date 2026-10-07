import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEvent } from "@neant/agent";
import { createActivity, reduce, render } from "../../../../src/tui/screens/chat/activity/activity";
import {
  APPROVAL_PHRASES,
  COMPACT_PHRASES,
  CONTINUE_PHRASES,
  FAIL_PHRASES,
  HOLIDAY_PHRASES,
  LUNAR_NEW_YEAR_PHRASES,
  NIGHT_PHRASES,
  RARE_PHRASES,
  THINKING_PHRASES,
  THINKING_TIERS,
  WEEKEND_PHRASES,
} from "../../../../src/tui/screens/chat/activity/phrases";

const sessionId = "activity-test";
const start = 1_790_942_400_000;
const random = () => 0;

test("English compaction, review, approval, failure and interruption keep their locale-specific priority copy", () => {
  let state = reduce(createActivity("en"), { type: "submit" }, start, random);
  state = reduce(
    state,
    { type: "compaction_start", trigger: "auto", sessionId, tokensBefore: 120_000 },
    start,
    random,
  );
  expect(render(state, start).line).toMatch(
    /^(Packing up context…|Tidying the context…) · total 0s$/,
  );
  state = reduce(
    state,
    { type: "permission_review", sessionId, phase: "start", toolCallId: "a", toolName: "bash" },
    start,
    random,
  );
  expect(render(state, start).line).toMatch(
    /^REVIEW · (Checking this call for surprises|Making sure the permission fits|Giving this tool call a once-over) · total 0s$/,
  );
  state = reduce(state, { type: "approval-open" }, start, random);
  expect(render(state, start).line).toMatch(
    /^(Waiting for your go-ahead|Your call — approval needed|The model is waiting on you) · total 0s$/,
  );
  state = reduce(state, { type: "approval-close" }, start, random);
  state = reduce(
    state,
    { type: "permission_review", sessionId, phase: "end", toolCallId: "a", decision: "allow" },
    start,
    random,
  );
  state = reduce(
    state,
    {
      type: "compaction_end",
      trigger: "auto",
      sessionId,
      summary: "private",
      tokensBefore: 120_000,
      tokensAfter: 18_000,
    },
    start,
    random,
  );
  expect(render(state, start).line).toBe("Compacted · 120.0k→18.0k · total 0s");
  state = reduce(state, toolStart("a"), start + 7000, random);
  state = reduce(state, toolEnd("a", true), start + 8000, random);
  expect(render(state, start + 8000).line).toBe("✗ That failed · Reading src/a.ts · 1s · total 8s");
  state = reduce(state, { type: "interrupt" }, start + 9000, random);
  expect(render(state, start + 9000).line).toBe("Again! Round two · total 9s");
  state = reduce(state, result(false), start + 9000, random);
  expect(render(state, start + 16_000).line).toBe(
    "That failed · 1 tool · thought 1s worked 1s · 🔥 12.3k",
  );
});

test.each([0, 1, 2])(
  "English summary uses the correct noun for %i tools and shared duration formatting",
  (count) => {
    let state = reduce(createActivity("en"), { type: "submit" }, start, random);
    state = reduce(state, delta(), start, random);
    for (let index = 0; index < count; index++)
      state = reduce(state, toolStart(String(index)), start + 65_000, random);
    state = reduce(state, result(), start + 130_000, random);
    expect(render(state, start + 130_000).line).toBe(
      count === 0
        ? "Done! · 0 tools · thought 2m 10s worked 0s · 🔥 12.3k"
        : `Done! · ${count} ${count === 1 ? "tool" : "tools"} · thought 1m 05s worked 1m 05s · 🔥 12.3k`,
    );
  },
);

test.each([
  "ffgrep",
  "fffind",
  "search-layer",
  "get_search_content",
  "batch_web_fetch",
  "agent_browser",
  "chrome_devtools",
  "unknown-tool",
])("English tool activity covers Neant's %s alias and tool streaks", (name) => {
  let state = reduce(createActivity("en"), { type: "submit" }, start, random);
  state = reduce(state, toolStart("a", name), start + 1000, random);
  state = reduce(state, toolStart("b", name), start + 2000, random);
  const line = render(state, start + 66_000).line;
  expect(line).toContain("1m 04s · tool x2 · total 1m 06s");
  expect(line).not.toMatch(/\p{Script=Han}/u);
});

function delta(
  text = "thinking",
  type: "text_delta" | "thinking_delta" = "thinking_delta",
): SessionEvent {
  const message = fauxAssistantMessage("");
  return {
    type: "message_update",
    sessionId,
    message,
    assistantMessageEvent: { type, contentIndex: 0, delta: text, partial: message },
  };
}

function toolStart(
  id: string,
  toolName = "read",
  args: unknown = { path: "src/a.ts" },
): SessionEvent {
  return { type: "tool_execution_start", sessionId, toolCallId: id, toolName, args };
}

function toolEnd(id: string, isError = false): SessionEvent {
  return {
    type: "tool_execution_end",
    sessionId,
    toolCallId: id,
    toolName: "read",
    result: {},
    isError,
  };
}

function result(success = true, totalTokens = 12_300): SessionEvent {
  return {
    type: "result",
    sessionId,
    text: "",
    success,
    durationMs: 0,
    usage: { input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens },
  };
}

test("a Run moves from waiting through thinking and tools to a persistent summary", () => {
  let state = createActivity();
  expect(render(state, start)).toEqual({ phase: "idle", line: "", nextWakeAt: undefined });
  state = reduce(state, { type: "submit" }, start, random);
  expect(render(state, start).phase).toBe("waiting");
  state = reduce(state, delta(), start + 1000, random);
  expect(render(state, start + 1000).phase).toBe("thinking");
  state = reduce(state, toolStart("a"), start + 13_000, random);
  expect(render(state, start + 13_000).phase).toBe("tool");
  state = reduce(state, toolEnd("a"), start + 24_000, random);
  expect(render(state, start + 24_000).phase).toBe("thinking");
  state = reduce(state, result(), start + 24_000, random);
  expect(render(state, start + 24_000)).toEqual({
    phase: "done",
    line: "交差！ · 1 工具 · 想12s 干11s · 🔥 12.3k",
    nextWakeAt: undefined,
  });
  expect(render(state, start + 99_000)).toEqual(render(state, start + 24_000));
  state = reduce(state, { type: "submit" }, start + 100_000, random);
  state = reduce(state, result(), start + 100_000, random);
  expect(render(state, start + 100_000).line).toBe("交差！ · 0 工具 · 想0s 干0s · 🔥 12.3k");
});

test("phrases stay fixed within four-second slots and reach all long-thinking tiers", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  expect(render(state, start).line).not.toBe("");
  expect(render(state, start + 3999).line.split(" · ")[0]).toBe(
    render(state, start).line.split(" · ")[0],
  );
  expect(render(state, start + 4000).line.split(" · ")[0]).not.toBe(
    render(state, start).line.split(" · ")[0],
  );
  state = reduce(state, delta(), start, random);
  const copy = (ms: number) => render(state, start + ms).line.split(" · ")[0]!;
  expect(copy(30_000)).toBe(copy(29_999));
  expect(THINKING_TIERS[0]!.pool).toContain(copy(32_000));
  expect(THINKING_TIERS[1]!.pool).toContain(copy(60_000));
  expect(THINKING_TIERS[2]!.pool).toContain(copy(300_000));
  expect(render(state, start + 300_001)).toEqual(render(state, start + 300_001));
});

test("tools retain their action, show a first-call opening, chain and linger after completion", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(state, delta(), start, random);
  state = reduce(state, toolStart("a"), start + 1000, random);
  expect(render(state, start + 1000).line).toContain("翻翻文档 src/a.ts · 0s");
  expect(render(state, start + 3499).line).toContain(" · 翻翻文档");
  expect(render(state, start + 3500).line).toBe("翻翻文档 src/a.ts · 2s · 总3s");
  state = reduce(state, toolEnd("a"), start + 3587, random);
  expect(render(state, start + 3587).line).toBe("✓ 翻翻文档 src/a.ts · 2s · 总3s");
  state = reduce(state, toolStart("b"), start + 3600, random);
  expect(render(state, start + 3600).line).toContain("工具x2");
  state = reduce(state, toolStart("c"), start + 3700, random);
  state = reduce(state, toolEnd("b"), start + 3787, random);
  expect(render(state, start + 3787).phase).toBe("tool");
  expect(render(state, start + 3787).line).toContain("工具x3");
  state = reduce(state, toolEnd("c"), start + 4000, random);
  expect(render(state, start + 6499).line).toContain("✓ 翻翻文档 src/a.ts · 300ms");
  expect(render(state, start + 6500).line).not.toContain("✓");
  state = reduce(state, toolStart("d"), start + 14_001, random);
  expect(render(state, start + 14_001).line).not.toContain("工具x");
});

test("tool details follow argument priority and fit forty display columns without splitting graphemes", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(
    state,
    toolStart("a", "bash", { path: "\u001b[31m中文\u001b[0m\n 👩‍💻".repeat(12), command: "ignored" }),
    start,
    random,
  );
  const fragment = render(state, start + 2500).line.split(" · ")[0]!;
  expect(fragment).toStartWith("跑个命令 中文 👩‍💻");
  expect(fragment).not.toContain("ignored");
  expect(fragment).not.toContain("\u001b");
  expect(fragment).not.toContain("\n");
  expect(Bun.stringWidth(fragment.slice("跑个命令 ".length))).toBeLessThanOrEqual(40);
  for (const [args, expected] of [
    [{ path: "", file: "a.ts", command: "no" }, "a.ts"],
    [{ file_path: "b.ts" }, "b.ts"],
    [{ command: "bun test", cmd: "no" }, "bun test"],
    [{ cmd: "pwd" }, "pwd"],
    [{ pattern: "TODO", query: "no" }, "TODO"],
    [{ query: "bugs" }, "bugs"],
    [{ url: "https://example.com" }, "https://example.com"],
    [{ description: "fix", name: "no" }, "fix"],
    [{ name: "echo" }, "echo"],
    [null, ""],
  ] as const) {
    const fresh = reduce(
      reduce(createActivity(), { type: "submit" }, start, random),
      toolStart("b", "read", args),
      start,
      random,
    );
    expect(render(fresh, start + 2500).line).toStartWith(
      `翻翻文档${expected ? ` ${expected}` : ""} · `,
    );
  }
});

test("split self-narration only starts at a line boundary and expires after five silent seconds", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(state, delta("正文里的 ⏵ 不算自述\n⏵ 查", "text_delta"), start, random);
  state = reduce(state, delta("一下报错原因\n正文", "text_delta"), start + 100, random);
  expect(render(state, start + 5099).line).toStartWith("⏵ 查一下报错原因 · ");
  expect(render(state, start + 5100).line).not.toContain("⏵");
  state = reduce(state, { type: "turn_start", sessionId }, start + 6000, random);
  state = reduce(state, delta("正文 ⏵ 不算", "text_delta"), start + 6000, random);
  expect(render(state, start + 6000).line).not.toContain("⏵");
  state = reduce(state, delta(`\n⏵ ${"👩‍💻中文é".repeat(30)}`, "text_delta"), start + 6100, random);
  const narration = render(state, start + 6100)
    .line.split(" · ")[0]!
    .slice(2);
  expect(Bun.stringWidth(narration)).toBeLessThanOrEqual(80);
  expect(narration).toStartWith("👩‍💻中文é");
});

test("compaction copy stays deterministic above other copy and below approval without changing phase", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(state, delta("⏵ 在查问题", "text_delta"), start, random);
  state = reduce(state, { type: "interrupt" }, start + 50, random);
  state = reduce(
    state,
    { type: "compaction_start", trigger: "auto", sessionId, tokensBefore: 120_000 },
    start + 100,
    random,
  );
  const phrase = render(state, start + 100).line.split(" · ")[0]!;
  expect(["收拾一下上下文…", "整理背包中…"]).toContain(phrase);
  expect(render(state, start + 30_000)).toMatchObject({
    phase: "thinking",
    line: `${phrase} · 总30s`,
  });
  expect(render(state, start + 30_000)).toEqual(render(state, start + 30_000));
  state = reduce(state, { type: "approval-open" }, start + 200, random);
  expect(APPROVAL_PHRASES).toContain(render(state, start + 200).line.split(" · ")[0]!);
  state = reduce(state, { type: "approval-close" }, start + 300, random);
  expect(render(state, start + 300).line).toStartWith(`${phrase} · `);
  state = reduce(state, result(), start + 31_000, random);
  expect(render(state, start + 31_000).line).toContain("想31s");
});

test.each(["waiting", "thinking", "tool"] as const)(
  "compaction preserves the %s phase and keeps elapsed time advancing",
  (phase) => {
    let state = reduce(createActivity(), { type: "submit" }, start, random);
    if (phase === "thinking") state = reduce(state, delta(), start + 50, random);
    if (phase === "tool") state = reduce(state, toolStart("a"), start + 50, random);
    state = reduce(
      state,
      { type: "compaction_start", trigger: "auto", sessionId, tokensBefore: 120_000 },
      start + 100,
      random,
    );
    const line = render(state, start + 100).line.split(" · ")[0]!;
    expect(["收拾一下上下文…", "整理背包中…"]).toContain(line);
    expect(render(state, start + 5000)).toMatchObject({ phase, line: `${line} · 总5s` });
    expect(render(state, start + 5000).nextWakeAt).toBeGreaterThan(start + 5000);
  },
);

const clearingEvents: Parameters<typeof reduce>[1][] = [
  {
    type: "compaction_end",
    trigger: "auto",
    sessionId,
    summary: "private summary",
    tokensBefore: 120_000,
    tokensAfter: 18_000,
  },
  { type: "message_start", sessionId, message: fauxAssistantMessage("") },
  result(),
  { type: "interrupt" },
];
test.each(clearingEvents)("$type clears compaction waiting copy", (event) => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(
    state,
    { type: "compaction_start", trigger: "auto", sessionId, tokensBefore: 120_000 },
    start + 100,
    random,
  );
  state = reduce(state, event, start + 200, random);
  expect(render(state, start + 200).line).not.toMatch(/收拾一下上下文|整理背包中/);
  if (event.type === "result") {
    state = reduce(state, { type: "submit" }, start + 300, random);
    expect(render(state, start + 300).line).not.toMatch(/收拾一下上下文|整理背包中/);
  }
});

test("compaction completion reports formatted before and after tokens for exactly six seconds", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(
    state,
    { type: "compaction_start", trigger: "auto", sessionId, tokensBefore: 120_000 },
    start + 100,
    random,
  );
  state = reduce(state, clearingEvents[0]!, start + 200, random);
  state = reduce(
    state,
    { type: "message_start", sessionId, message: fauxAssistantMessage("") },
    start + 201,
    random,
  );
  expect(render(state, start + 200).line).toBe("压缩了一下 · 120.0k→18.0k · 总0s");
  expect(render(state, start + 6199).line).toContain("120.0k→18.0k");
  expect(render(state, start + 6199).nextWakeAt).toBe(start + 6200);
  expect(render(state, start + 6200).line).not.toContain("120.0k→18.0k");
  expect(render(state, start + 200).line).not.toContain("private summary");
});

test("approval overrides narration and compaction; a closed dialog restores fresh copy", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(state, delta("⏵ 在查问题", "text_delta"), start, random);
  state = reduce(
    state,
    {
      type: "compaction_end",
      trigger: "auto",
      sessionId,
      summary: "",
      tokensBefore: 1,
      tokensAfter: 0,
    },
    start + 100,
    random,
  );
  expect(render(state, start + 100).line).toStartWith(`${COMPACT_PHRASES[0]} · `);
  state = reduce(state, { type: "approval-open" }, start + 200, random);
  expect(APPROVAL_PHRASES).toContain(render(state, start + 200).line.split(" · ")[0]!);
  state = reduce(state, { type: "approval-close" }, start + 300, random);
  expect(render(state, start + 6099).line).toStartWith(`${COMPACT_PHRASES[0]} · `);
  expect(render(state, start + 6100).line).not.toContain(COMPACT_PHRASES[0]!);
});

test("interruption quips last six seconds after failure, then leave a stable failure summary", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(state, { type: "interrupt" }, start + 100, random);
  expect(render(state, start + 100).line).toStartWith(`${CONTINUE_PHRASES[0]} · `);
  state = reduce(state, result(false), start + 200, random);
  expect(render(state, start + 6199).line).toStartWith(`${CONTINUE_PHRASES[0]} · `);
  expect(render(state, start + 6200).line).toStartWith(`${FAIL_PHRASES[0]} · 0 工具`);
  expect(render(state, start + 6200).nextWakeAt).toBeUndefined();
  state = reduce(state, { type: "submit" }, start + 7000, random);
  expect(render(state, start + 7000).line).not.toContain(CONTINUE_PHRASES[0]!);
});

test("the next wake is the earliest displayed second, phrase rotation or expiry", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  expect(render(state, start + 123).nextWakeAt).toBe(start + 1000);
  state = reduce(state, delta(), start + 150, random);
  expect(render(state, start + 4001).nextWakeAt).toBe(start + 4150);
  state = reduce(state, toolStart("a"), start + 4250, random);
  expect(render(state, start + 6751).nextWakeAt).toBe(start + 7000);
  state = reduce(state, toolEnd("a"), start + 6770, random);
  expect(render(state, start + 9250).nextWakeAt).toBe(start + 9270);
  state = reduce(state, delta("⏵ 查问题", "text_delta"), start + 9501, random);
  expect(render(state, start + 14_500).nextWakeAt).toBe(start + 14_501);
  state = reduce(state, { type: "interrupt" }, start + 15_500, random);
  state = reduce(state, result(false), start + 15_600, random);
  expect(render(state, start + 15_600).nextWakeAt).toBe(start + 21_600);
});

test("holiday and weekend greetings appear only in the first thinking window", () => {
  for (const [date, pool] of [
    [new Date(2026, 0, 1, 12), HOLIDAY_PHRASES["01-01"]!],
    [new Date(2026, 1, 17, 12), LUNAR_NEW_YEAR_PHRASES],
    [new Date(2026, 9, 3, 12), WEEKEND_PHRASES],
  ] as const) {
    const now = date.getTime();
    // Run seed is stable; calendar selection comes from the render instant.
    let state = reduce(createActivity(), { type: "submit" }, start, random);
    state = reduce(state, delta(), now, random);
    expect(pool).toContain(render(state, now).line.split(" · ")[0]!);
    expect(THINKING_PHRASES).toContain(render(state, now + 4000).line.split(" · ")[0]!);
  }
});

test("rare copy is seeded once per Run, rotates after 7.5 seconds and stops after the first thinking phase", () => {
  const now = start + 244;
  let state = reduce(createActivity(), { type: "submit" }, now, random);
  state = reduce(state, delta(), now, random);
  const copy = (offset: number) => render(state, now + offset).line.split(" · ")[0]!;
  expect(RARE_PHRASES).toContain(copy(0));
  expect(copy(7499)).toBe(copy(0));
  expect(copy(7500)).not.toBe(copy(0));
  expect(render(state, now + 7001).nextWakeAt).toBe(now + 7500);
  state = reduce(state, toolStart("a"), now + 8000, random);
  state = reduce(state, toolEnd("a"), now + 8100, random);
  expect(THINKING_PHRASES).toContain(copy(11_000));
});

test("night copy mixes into short thinking without overriding long-thinking tiers", () => {
  const now = new Date(2026, 9, 2, 3).getTime();
  const observed = [];
  for (let offset = 0; offset < 200; offset++) {
    let state = reduce(createActivity(), { type: "submit" }, now + offset, random);
    state = reduce(state, delta(), now + offset, random);
    state = reduce(state, toolStart("a"), now + offset, random);
    state = reduce(state, toolEnd("a"), now + offset, random);
    observed.push(render(state, now + offset + 2500).line.split(" · ")[0]!);
    expect(THINKING_TIERS[2]!.pool).toContain(
      render(state, now + offset + 300_000).line.split(" · ")[0]!,
    );
  }
  expect(observed.some((phrase) => NIGHT_PHRASES.includes(phrase))).toBe(true);
});

test("Run summaries use cumulative result usage across Turns and ignore late events", () => {
  let state = reduce(createActivity(), { type: "submit" }, 0, random);
  state = reduce(state, { type: "git-branch", branch: "main\n" }, 0, random);
  state = reduce(state, delta(), 0, random);
  state = reduce(state, toolStart("a"), 1000, random);
  state = reduce(state, toolEnd("a"), 2000, random);
  state = reduce(state, { type: "turn_start", sessionId }, 2000, random);
  state = reduce(state, delta(), 2000, random);
  state = reduce(state, toolStart("b"), 3000, random);
  state = reduce(state, toolEnd("b"), 4000, random);
  state = reduce(state, result(true, 1_234_567), 5000, random);
  expect(render(state, 5000).line).toBe("交差！ · 2 工具 · 想3s 干2s · 🔥 1.2M · git main");
  expect(render(reduce(state, toolStart("late"), 6000, random), 6000)).toEqual(render(state, 5000));
  expect(render(reduce(state, result(false), 6000, random), 6000)).toEqual(render(state, 5000));
  state = reduce(state, { type: "submit" }, 7000, random);
  state = reduce(state, result(true, 0), 7000, random);
  expect(render(state, 7000).line).toBe("交差！ · 0 工具 · 想0s 干0s · git main");
});

test("reduce and render leave their input values unchanged and do not redraw stored actions", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(state, toolStart("a"), start, random);
  const before = JSON.stringify(state);
  const first = render(state, start + 2500);
  expect(render(state, start + 2500)).toEqual(first);
  expect(JSON.stringify(state)).toBe(before);
  const after = reduce(state, toolEnd("a"), start + 3000, () => 0.9);
  expect(JSON.stringify(state)).toBe(before);
  expect(render(after, start + 3000).line).toStartWith("✓ 翻翻文档 src/a.ts");
});

test("failed tools show a failure quip instead of a success checkmark", () => {
  let state = reduce(createActivity(), { type: "submit" }, start, random);
  state = reduce(state, toolStart("a"), start, random);
  state = reduce(state, toolEnd("a", true), start + 87, random);
  expect(render(state, start + 87).line).toBe("✗ 翻车了 · 翻翻文档 src/a.ts · 87ms · 总0s");
});
