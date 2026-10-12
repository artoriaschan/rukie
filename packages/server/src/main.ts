import { runServer } from "./process.ts";
import { readSidecarStartup } from "./startup.ts";

await runServer({
  ...readSidecarStartup(process.env),
  development: process.argv.includes("--dev"),
});
