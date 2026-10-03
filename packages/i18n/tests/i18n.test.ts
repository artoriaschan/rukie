import { expect, test } from "bun:test";
import {
  common,
  createI18n,
  fmtDuration,
  resolveLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from "../src/index";

test.each([
  [["zh_TW", "en_US.UTF-8"], "zh"],
  [[undefined, "C.UTF-8", "POSIX", "", "fr", "zh-Hant"], "zh"],
  [["en-GB", "zh_CN.UTF-8"], "en"],
  [["zh", "en"], "zh"],
  [["zh_HK.UTF-8"], "zh"],
  [["en_US.UTF-8"], "en"],
  [["fr", "C", undefined], "en"],
  [[], "en"],
] as const)("locale candidates %j resolve to %s", (candidates, expected) => {
  expect(resolveLocale([...candidates])).toBe(expected);
});

test.each([
  [0, "0s", "0s"],
  [999, "0s", "0s"],
  [1000, "1s", "1s"],
  [59999, "59s", "59s"],
  [60000, "1m0s", "1m 00s"],
  [65000, "1m5s", "1m 05s"],
  [3599999, "59m59s", "59m 59s"],
  [3600000, "1h0m", "1h 00m"],
  [3660000, "1h1m", "1h 01m"],
] as const)("duration %s uses the locale format", (ms, zh, en) => {
  expect(fmtDuration(ms, "zh")).toBe(zh);
  expect(fmtDuration(ms, "en")).toBe(en);
});

// These checks run under tsc -b, so rejection remains part of the public API contract.
function translationTypes() {
  const common = { zh: { mode: "询问" }, en: { mode: "Ask" } } as const;
  const app = { zh: { hello: "你好 {{name}}" }, en: { hello: "Hi {{name}}" } } as const;
  const t = createI18n("en", { common, app });
  // @ts-expect-error App dictionaries cannot override common keys.
  createI18n("en", { common, app: common });
  const enOverride = {
    zh: { hello: "你好 {{name}}" },
    en: { hello: "Hi {{name}}", mode: "Override" },
  } as const;
  // @ts-expect-error An English-only override of a common key is also forbidden.
  createI18n("en", { common, app: enOverride });
  // @ts-expect-error Unknown translation key.
  t("unknown");
  // @ts-expect-error Interpolation requires the named parameter.
  t("hello");
  // @ts-expect-error Incorrect parameter name.
  t("hello", { user: "world" });
}
void translationTypes;

test("common permission concepts have translations in both supported locales", () => {
  const labels = {
    zh: ["询问", "自动评审", "完全访问", "允许（仅本次）", "本 session 内一直允许这个工具", "拒绝"],
    en: [
      "Ask",
      "Auto review",
      "Full access",
      "Allow once",
      "Always allow this tool for this session",
      "Deny",
    ],
  } satisfies Record<Locale, string[]>;
  for (const locale of SUPPORTED_LOCALES) {
    const t = createI18n(locale, { common, app: { zh: {}, en: {} } });
    expect([
      t("permission-mode.ask.name"),
      t("permission-mode.auto-review.name"),
      t("permission-mode.full-access.name"),
      t("approval.allow-once"),
      t("approval.allow-tool"),
      t("approval.deny"),
    ]).toEqual(labels[locale]);
  }
});

test("common zh/en keys use identical interpolation parameters", () => {
  const placeholders = (text: string) =>
    [...new Set([...text.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]))].sort();
  for (const key of Object.keys(common.zh) as (keyof typeof common.zh)[]) {
    expect(placeholders(common.en[key])).toEqual(placeholders(common.zh[key]));
  }
});

test("common and app translations compose and interpolate literal parameter values", () => {
  const common = { zh: { mode: "询问" }, en: { mode: "Ask" } } as const;
  const app = {
    zh: { greeting: "你好 {{name}}，共 {{count}} 次：{{name}}" },
    en: { greeting: "Hello {{name}}, {{count}} times: {{name}}" },
  } as const;
  const t = createI18n("en", { common, app });
  expect(t("mode")).toBe("Ask");
  expect(t("greeting", { name: "$&{{count}}", count: 2 })).toBe(
    "Hello $&{{count}}, 2 times: $&{{count}}",
  );
  expect(createI18n("zh", { common, app })("greeting", { name: "世界", count: 0 })).toBe(
    "你好 世界，共 0 次：世界",
  );
  // @ts-expect-error Unknown keys are rejected statically, but have a runtime fallback.
  expect(t("missing")).toBe("missing");
  // @ts-expect-error Object prototype names are also missing translation keys.
  expect(t("toString")).toBe("toString");
  // @ts-expect-error Missing keys are returned literally, even if they resemble templates.
  expect(t("missing-{{name}}", { name: "world" })).toBe("missing-{{name}}");
});
