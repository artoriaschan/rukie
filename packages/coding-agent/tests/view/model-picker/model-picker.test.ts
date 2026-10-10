import { expect, test } from "bun:test";
import type { ModelCatalogEntry } from "@rukie/agent";
import { filterModelTabs, modelProviderTabs, modelRowText } from "../../../src/view/model-picker";

const model = (providerId: string, custom: boolean, authenticated: boolean): ModelCatalogEntry => ({
  spec: `${providerId}/same`,
  id: "same",
  name: "Same Name",
  providerId,
  providerName: providerId,
  custom,
  authenticated,
  input: ["text"],
  reasoning: false,
  thinkingLevels: ["off"],
  contextWindow: 128000,
});
test("visible providers keep custom and current entries and order custom tabs first", () => {
  const tabs = modelProviderTabs(
    [
      model("z-custom", true, false),
      model("b", false, true),
      model("a", false, false),
      model("current", false, false),
    ],
    "current/same",
  );
  expect(tabs.map((tab) => tab.id)).toEqual(["z-custom", "b", "current"]);
});
test("row truncation preserves the distinguishing spec before the name", () => {
  expect(
    modelRowText({ name: "Same Name", spec: "custom/same" }, 14, (text) => text.length),
  ).toEqual({ name: "S…", spec: "custom/same" });
  expect(
    modelRowText({ name: "custom/same", spec: "custom/same" }, 10, (text) => text.length),
  ).toEqual({ name: "", spec: "custom/sa…" });
});

test("filter matches model names, specs and provider display names across visible tabs", () => {
  const tabs = modelProviderTabs(
    [
      { ...model("alpha", true, true), providerName: "Team Gateway" },
      { ...model("beta", true, true), name: "Reasoner" },
      model("hidden", false, false),
    ],
    "alpha/same",
  );
  expect(filterModelTabs(tabs, "TEAM").map((entry) => entry.spec)).toEqual(["alpha/same"]);
  expect(filterModelTabs(tabs, "REASON").map((entry) => entry.spec)).toEqual(["beta/same"]);
  expect(filterModelTabs(tabs, "/SAME").map((entry) => entry.spec)).toEqual([
    "beta/same",
    "alpha/same",
  ]);
  expect(filterModelTabs(tabs, "hidden")).toEqual([]);
});
