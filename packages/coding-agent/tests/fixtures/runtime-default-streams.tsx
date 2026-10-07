import React from "react";
import { renderSync, Text } from "../../src/ink/index.ts";
const app = renderSync(<Text>default Bun streams</Text>, { patchConsole: false });
app.unmount();
await app.waitUntilExit();
app.cleanup();
