import React from "react";
import render from "./src/ink/root.js";
import Text from "./src/ink/components/Text.js";
const app = await render(<Text>default Bun streams</Text>, { patchConsole: false });
const exited = app.waitUntilExit();
app.unmount();
await exited;
app.cleanup();
