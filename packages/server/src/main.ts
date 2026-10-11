import { homedir } from "node:os";
import { runServer } from "./process.ts";

await runServer({ homeDir: homedir(), development: process.argv.includes("--dev") });
