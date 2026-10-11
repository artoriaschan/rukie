import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fakeModel } from "../../../agent/tests/helpers/fake-model.ts";
import { runServer } from "../../src/process.ts";

const homeDir = process.argv[2]!;
// Reads a FIFO indefinitely; parent cleanup signals the actual process group, without fixed sleeps.
await runServer({
  homeDir,
  sessionOptions: {
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", {
          command: "mkfifo input; printf '%s' $$ > pid; exec cat input",
          description: "Keep process alive until shutdown",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("started"),
    ]),
    settings: { permissionMode: "full-access" },
  },
});
