import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

// A real JSON-RPC stdio server. Its manifest can change between Runs.
const manifest = await Bun.file(process.env.MCP_MANIFEST!).json();
appendFileSync(process.env.MCP_PIDS!, `${process.pid}\n`);
const lines = createInterface({ input: process.stdin });
const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  switch (request.method) {
    case "initialize":
      if (manifest.hangInitialize) continue;
      result = {
        protocolVersion: request.params.protocolVersion,
        serverInfo: { name: "neant-test", version: "1" },
        capabilities: { tools: {} },
        instructions: manifest.instructions,
      };
      break;
    case "tools/list":
      result = {
        tools: (manifest.tools ?? ["echo"]).map((name: string) => ({
          name,
          description: `Test ${name}`,
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
        })),
      };
      break;
    case "tools/call":
      appendFileSync(process.env.MCP_CALLS!, `${request.params.name}\n`);
      if (process.env.MCP_ARGUMENTS)
        appendFileSync(process.env.MCP_ARGUMENTS, `${JSON.stringify(request.params.arguments)}\n`);
      if (request.params.name === "hang") continue;
      if (request.params.name === "crash") process.exit(1);
      if (request.params.name === "delayed-json")
        await Bun.sleep(request.params.arguments.delay_ms);
      result = {
        content: [
          {
            type: "text",
            text: ["json", "delayed-json"].includes(request.params.name)
              ? request.params.arguments.text
              : `MCP: ${request.params.arguments.text ?? "called"}`,
          },
        ],
        isError: request.params.name === "error",
      };
      break;
    default:
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown method" } });
      continue;
  }
  send({ jsonrpc: "2.0", id: request.id, result });
}
