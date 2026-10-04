import {
  createUserVisibleError,
  type UserVisibleErrorCode,
  type UserVisibleErrorParams,
} from "@neant/shared";
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
    zh: ["询问", "自动评审", "完全访问", "允许（仅本次）", "本 session 允许此工具", "拒绝"],
    en: [
      "Ask",
      "Auto review",
      "Full access",
      "Allow once",
      "Allow this tool for this session",
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

test.each([
  [
    "zh",
    "未配置模型。请在 /home/test/.neant/settings.json 中设置 model，或传入 --model provider/id。",
  ],
  [
    "en",
    'No model configured. Set "model" in /home/test/.neant/settings.json or pass --model provider/id.',
  ],
] as const)("%s common errors interpolate the settings path", (locale, expected) => {
  const t = createI18n(locale, { common, app: { zh: {}, en: {} } });
  const message = t("error.no-model", { settings: "/home/test/.neant/settings.json" });
  expect(message).toStartWith(expected);
  expect(message).toContain("ANTHROPIC_API_KEY");
  expect(message).toContain('"apiKeyEnv": "LOCAL_API_KEY"');
});

test.each([
  [
    "zh",
    '未知模型 "missing/model"。',
    '缺少 provider "local" 的 API key。环境变量：TEST_KEY。',
    "Session 不存在：missing",
    "内置 ripgrep 不可用。",
  ],
  [
    "en",
    'Unknown model "missing/model".',
    'No API key for provider "local". Environment variable: TEST_KEY.',
    "Session not found: missing",
    "Bundled ripgrep is unavailable.",
  ],
] as const)(
  "%s common errors cover the remaining four codes",
  (locale, model, key, session, grep) => {
    const t = createI18n(locale, { common, app: { zh: {}, en: {} } });
    expect(t("error.unknown-model", { model: "missing/model" })).toBe(model);
    expect(t("error.no-api-key", { provider: "local", env: "TEST_KEY" })).toBe(key);
    expect(t("error.session-not-found", { id: "missing" })).toBe(session);
    const message = t("error.ripgrep-unavailable", { cause: "binary unavailable" });
    expect(message).toStartWith(grep);
    expect(message).toContain("optionalDependencies");
    expect(message).toEndWith("binary unavailable");
  },
);

function errorTypes() {
  const t = createI18n("en", { common, app: { zh: {}, en: {} } });
  // @ts-expect-error Error parameters must match their code.
  createUserVisibleError("unknown", { code: "unknown-model", params: { id: "missing" } });
  // @ts-expect-error All no-api-key parameters are required.
  const keyParams: UserVisibleErrorParams["no-api-key"] = { provider: "local" };
  void keyParams;
  // @ts-expect-error Error translations infer their named parameters.
  t("error.session-not-found", { model: "missing" });
  const missing: Omit<typeof common.zh, "error.session-not-found"> = common.zh;
  // @ts-expect-error A common dictionary cannot omit a shared error code.
  const complete: Record<`error.${UserVisibleErrorCode}`, string> = missing;
  void complete;
}
void errorTypes;
