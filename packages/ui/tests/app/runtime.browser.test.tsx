import { expect, test } from "vitest";
import type { ReactElement } from "react";
import { render } from "vitest-browser-react";
import { WIRE_SUBPROTOCOL } from "@rukie/shared";

test("React DOM renders workspace protocol in a real browser", async () => {
  const element: ReactElement = (
    <output aria-label="Protocol" className="text-ui-base">
      {WIRE_SUBPROTOCOL}
    </output>
  );
  const screen = await render(element);
  await expect.element(screen.getByLabelText("Protocol")).toHaveTextContent("rukie.v1");
});
