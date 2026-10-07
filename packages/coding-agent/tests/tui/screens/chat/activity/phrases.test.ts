import { expect, test } from "bun:test";
import * as phrases from "../../../../../src/tui/screens/chat/activity/phrases";

// The ticket deliberately preserves the upstream single-file pool contract.
const chinesePools = Object.entries(phrases).filter(
  ([name]) =>
    !name.startsWith("EN_") &&
    (name.endsWith("_PHRASES") ||
      ["THINKING_TIERS", "ACTION_MAP", "FALLBACK_ACTIONS"].includes(name)),
);

function expectEnglishPool(value: unknown) {
  if (typeof value === "string") {
    expect(value.length).toBeGreaterThan(0);
    expect(value).not.toMatch(/\p{Script=Han}/u);
  } else if (Array.isArray(value)) {
    expect(value.length).toBeGreaterThan(0);
    value.forEach(expectEnglishPool);
  } else if (value && typeof value === "object") {
    expect(Object.keys(value).length).toBeGreaterThan(0);
    Object.values(value)
      .filter((entry) => !(entry instanceof RegExp))
      .forEach(expectEnglishPool);
  } else {
    expect(typeof value).toBe("number");
  }
}

test.each(chinesePools)("%s has a non-empty English mirror", (name) => {
  const mirror = Reflect.get(phrases, `EN_${name}`);
  expect(mirror).toBeDefined();
  expectEnglishPool(mirror);
});

test.each(["zh", "en"] as const)(
  "%s calendar greetings share holiday and Lunar New Year dates",
  (locale) => {
    expect(phrases.holidayPhrase(new Date(2026, 0, 1), 1, 0, locale)).toBeDefined();
    expect(phrases.holidayPhrase(new Date(2026, 1, 17), 1, 0, locale)).toBeDefined();
    expect(phrases.holidayPhrase(new Date(2026, 1, 23), 1, 0, locale)).toBeDefined();
    expect(phrases.holidayPhrase(new Date(2026, 1, 24), 1, 0, locale)).toBeUndefined();
    expect(phrases.holidayPhrase(new Date(2026, 6, 15), 1, 0, locale)).toBeUndefined();
    if (locale === "en") {
      expect(phrases.holidayPhrase(new Date(2026, 0, 1), 1, 0, locale)).not.toMatch(
        /\p{Script=Han}/u,
      );
      expect(phrases.holidayPhrase(new Date(2026, 1, 17), 1, 0, locale)).not.toMatch(
        /\p{Script=Han}/u,
      );
    }
  },
);
