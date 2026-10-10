import { describe, expect, test } from "vitest";
import { cn } from "../../src/lib/utils";

describe("component class composition", () => {
  test("preserves independent typography and color", () => {
    expect(cn("text-ui-sm", "text-muted-foreground")).toBe("text-ui-sm text-muted-foreground");
    expect(cn("text-muted-foreground", "text-ui-sm")).toBe("text-muted-foreground text-ui-sm");
  });
  test("caller overrides size and color independently", () => {
    expect(cn("text-ui-base text-foreground", "text-ui-control text-danger")).toBe(
      "text-ui-control text-danger",
    );
  });
});
