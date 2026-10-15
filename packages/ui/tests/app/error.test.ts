import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { useErrorText } from "../../src/app/error";
import { WireError } from "../../src/client";
import { UiLocaleProvider } from "../../src/lib/i18n";

test.each([
  ["en", "Goal operation requires an idle Session."],
  ["zh", "请在会话空闲时操作 Goal。"],
] as const)("Goal errors use common localized copy in %s", (locale, expected) => {
  function Message() {
    return useErrorText()(new WireError("goal-busy"));
  }
  expect(
    renderToStaticMarkup(
      createElement(UiLocaleProvider, { locale, children: createElement(Message) }),
    ),
  ).toBe(expected);
});
