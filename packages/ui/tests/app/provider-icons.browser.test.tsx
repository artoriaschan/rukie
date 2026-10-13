import { expect, onTestFinished, test } from "vitest";
import { render } from "vitest-browser-react";
import { ModelPicker } from "../../src/components/model-picker";
import { ModelServices } from "../../src/app/model-services";
import { UiLocaleProvider } from "../../src/lib/i18n";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("service list and detail use the explicit brand key and keep unmarked names generic", async () => {
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => [
            {
              id: "account-2",
              name: "Research account",
              icon: "deepseek",
              api: "openai-completions",
              baseUrl: "https://api.deepseek.com",
              models: [],
              hasCredential: false,
            },
            {
              id: "deepseek",
              name: "DeepSeek",
              api: "openai-completions",
              baseUrl: "https://example.com",
              models: [],
              hasCredential: false,
            },
          ],
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  onTestFinished(() => screen.unmount());
  const brand = screen.getByRole("button", { name: "Research account", exact: true });
  await expect.element(brand).toBeVisible();
  const heading = screen.getByRole("heading", { name: "Research account", exact: true });
  await expect.element(heading).toBeVisible();
  for (const node of [brand.element(), heading.element()]) {
    const icon = node.querySelector('[data-provider-brand="deepseek"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.querySelector("path")?.getAttribute("fill")).toBe("#4D6BFE");
  }
  const generic = screen.getByRole("button", { name: "DeepSeek", exact: true });
  expect(generic.element().querySelector(".lucide-box")).not.toBeNull();
  await generic.click();
  const genericHeading = screen.getByRole("heading", { name: "DeepSeek", exact: true });
  await expect.element(genericHeading).toBeVisible();
  expect(genericHeading.element().querySelector(".lucide-box")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
});

test("model picker uses catalog providerIcon instead of inferring a brand from identity", async () => {
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelPicker
        disabled={false}
        onModel={() => {}}
        models={[
          {
            spec: "private/flash",
            id: "flash",
            name: "Flash",
            providerId: "private",
            providerName: "Research account",
            providerIcon: "deepseek",
            input: ["text"],
            reasoning: false,
            thinkingLevels: [],
            contextWindow: 1000000,
            custom: true,
            authenticated: true,
          },
          {
            spec: "deepseek/unmarked",
            id: "unmarked",
            name: "Unmarked",
            providerId: "deepseek",
            providerName: "DeepSeek",
            input: ["text"],
            reasoning: false,
            thinkingLevels: [],
            contextWindow: 1000000,
            custom: true,
            authenticated: true,
          },
        ]}
      />
    </UiLocaleProvider>,
  );
  onTestFinished(() => screen.unmount());
  await screen.getByRole("button", { name: "Choose model", exact: true }).click();
  const brand = screen.getByRole("menuitem", { name: /Flash/ });
  await expect.element(brand).toBeVisible();
  const icon = brand.element().querySelector('[data-provider-brand="deepseek"]');
  expect(icon).not.toBeNull();
  expect(icon?.getAttribute("aria-hidden")).toBe("true");
  expect(icon?.getAttribute("fill")).toBe("currentColor");
  const generic = screen.getByRole("menuitem", { name: /Unmarked/ });
  expect(generic.element().querySelector(".lucide-box")?.getAttribute("aria-hidden")).toBe("true");
});
