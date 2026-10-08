import type { JsonValue } from "@earendil-works/chord";
import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { join } from "node:path";
import { stat } from "node:fs/promises";

/** A real process dies after an unsafe effect, before its native ToolResult commit is acknowledged. */
export function crashUnsafeEffect(
  root: string,
  child = false,
  options: {
    priorTurns?: { prompt: string; reply: string }[];
    completedReads?: boolean;
    unsafeCall?: { name: string; args: Record<string, JsonValue> };
  } = {},
) {
  return crashToolReceipt(root, child, { ...options, safeDelegation: false });
}

/** A replay-safe delegation already created its durable child before its root receipt is lost. */
export function crashSafeDelegation(root: string) {
  return crashToolReceipt(root, false, { safeDelegation: true });
}

async function crashToolReceipt(
  root: string,
  child: boolean,
  options: {
    priorTurns?: { prompt: string; reply: string }[];
    completedReads?: boolean;
    safeDelegation: boolean;
    unsafeCall?: { name: string; args: Record<string, JsonValue> };
  },
) {
  const script = `
    import { createSession, createJsonlStore } from "@rukie/agent";
    import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
    import { awaitWithContext, BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
    process.stdin.resume();
    let change = Promise.withResolvers();
    const changed = () => { const previous = change; change = Promise.withResolvers(); previous.resolve(); };
    const context = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
    const until = async predicate => { while (!predicate()) { const wake = change.promise; if (predicate()) return; await awaitWithContext(wake, context); } };
    const provider = fauxProvider({api:"faux",provider:"faux",tokensPerSecond:0});
    const calls = [];
    const models = createModels();
    models.setProvider({...provider.provider, streamSimple(_model, context) {
      const stream = createAssistantMessageEventStream();
      calls.push({ context, finish(text) {
        const message = fauxAssistantMessage(text);
        stream.push({type:"done",reason:"stop",message}); stream.end(message);
      }, tool(name,args) {
        const message = fauxAssistantMessage(Array.isArray(name) ? name : fauxToolCall(name,args),{stopReason:"toolUse"});
        stream.push({type:"done",reason:"toolUse",message}); stream.end(message);
      } });
      return stream;
    }});
    const fake = { model: provider.getModel(), models, calls };
    for (const provider of fake.models.getProviders()) fake.models.setProvider({ ...provider, streamSimple(...args) { const stream = provider.streamSimple(...args); changed(); return stream; } });
    const store = createJsonlStore({ cwd: ${JSON.stringify(root)}, homeDir: ${JSON.stringify(root)} });
    let session;
    let crashArmed = false;
    const wrapped = { ...store, async open(...args) {
      const lease = await store.open(...args);
      return { ...lease, storage: new Proxy(lease.storage, { get(target, key) {
        if (key === "commit") return async (writes, context) => {
          if (crashArmed && writes.some(write => write.type === "entry" && write.value.model?.some(message => message.role === "toolResult" && message.toolName === ${JSON.stringify(options.safeDelegation ? "subagent" : (options.unsafeCall?.name ?? "write"))}))) {
            const result = writes.find(write => write.type === "entry" && write.value.model?.some(message => message.role === "toolResult" && message.toolName === ${JSON.stringify(options.safeDelegation ? "subagent" : (options.unsafeCall?.name ?? "write"))}));
            const toolTaskId = result?.value.byTaskId;
            const task = toolTaskId === undefined ? undefined : await target.task(toolTaskId, context);
            const checkpoint = task?.state.status === "running" ? task.state.checkpoint : undefined;
            if (checkpoint?.phase !== "execute" || checkpoint.replay !== ${JSON.stringify(options.safeDelegation ? "safe" : "unsafe")}) throw new Error("Expected committed execution intent at receipt barrier: " + JSON.stringify({toolTaskId, task, result}));
            const identities = session.toolState("subagents");
            const childId = Array.isArray(identities) ? identities.find(row => row.description === "Unknown child")?.id : undefined;
            process.stdout.write("READY " + JSON.stringify({ sessionId: session.id, childId, toolTaskId, replay: checkpoint.replay }) + "\\n");
            return await new Promise(() => {});
          }
          return target.commit(writes, context);
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } }) };
    } };
    await Bun.write(${JSON.stringify(join(root, "uncertain-effect.txt"))}, "before effect");
    session = await createSession({ cwd: ${JSON.stringify(root)}, homeDir: ${JSON.stringify(root)}, ...fake, store: wrapped, permissionMode: "full-access" });
    await session.rename("Native crash fixture");
    session.subscribe(changed);
    if (${!!options.completedReads}) {
      await Bun.write(${JSON.stringify(join(root, "successful-read.txt"))}, "saved output");
      const index = fake.calls.length;
      const run = session.run("record real read success and failure");
      await until(() => fake.calls.length > index);
      fake.calls[index].tool([fauxToolCall("read",{path:"successful-read.txt"},{id:"real-success"}),fauxToolCall("read",{path:"missing-read.txt"},{id:"real-failure"})]);
      await until(() => fake.calls.length > index + 1);
      fake.calls[index+1].finish("read facts saved");
      await run;
    }
    for (const turn of ${JSON.stringify(options.priorTurns ?? [])}) {
      const index = fake.calls.length;
      const run = session.run(turn.prompt);
      await until(() => fake.calls.length > index);
      fake.calls[index].finish(turn.reply);
      await run;
    }
    crashArmed = true;
    const initial = fake.calls.length;
    void session.run("fixture parent").catch(error => { process.stderr.write(String(error)); process.exit(1); });
    await until(() => fake.calls.length > initial);
    const effect = { path: "uncertain-effect.txt", content: "saved effect" };
    if (${child}) {
      fake.calls[initial].tool("subagent", { description: "Unknown child", prompt: "native unsafe child", run_in_background: true });
      await until(() => fake.calls.some(call => call.context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("native unsafe child"))));
      const childCall = fake.calls.find(call => call.context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("native unsafe child")));
      childCall.tool(${JSON.stringify(options.unsafeCall?.name ?? "write")}, ${options.unsafeCall ? JSON.stringify(options.unsafeCall.args) : "effect"});
    } else if (${options.safeDelegation}) fake.calls[initial].tool("subagent", { description: "Unknown child", prompt: "accepted safe child", run_in_background: true });
    else fake.calls[initial].tool(${JSON.stringify(options.unsafeCall?.name ?? "write")}, ${options.unsafeCall ? JSON.stringify(options.unsafeCall.args) : "effect"});
  `;
  const process = Bun.spawn([globalThis.process.execPath, "-e", script], {
    cwd: join(import.meta.dir, "../.."),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const errors = new Response(process.stderr).text();
  const reader = process.stdout.getReader();
  // The child has its own clock; this bounds the actual process/transport contract.
  const context = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  let output = "";
  try {
    while (!output.includes("\n")) {
      const next = await awaitWithContext(reader.read(), context);
      if (next.done) throw new Error(`Native crash fixture exited: ${await errors}`);
      output += new TextDecoder().decode(next.value);
    }
    const line = output.split("\n").find((line) => line.startsWith("READY "));
    if (!line) throw new Error(`Native crash fixture did not publish an identity: ${output}`);
    const value: unknown = JSON.parse(line.slice(6));
    if (
      typeof value !== "object" ||
      value === null ||
      !("sessionId" in value) ||
      typeof value.sessionId !== "string"
    )
      throw new Error("Invalid native crash fixture identity");
    if (
      !("toolTaskId" in value) ||
      !Number.isSafeInteger(value.toolTaskId) ||
      !("replay" in value) ||
      value.replay !== (options.safeDelegation ? "safe" : "unsafe")
    )
      throw new Error("Invalid committed tool execution intent");
    const childId =
      "childId" in value && typeof value.childId === "string" ? value.childId : undefined;
    if (child && !childId) throw new Error("Native child identity missing at effect commit");
    process.kill("SIGKILL");
    await process.exited;
    const stderr = await errors;
    if (stderr) throw new Error(stderr);
    return {
      sessionId: value.sessionId,
      childId,
      effectModifiedAt: (await stat(join(root, "uncertain-effect.txt"))).mtimeMs,
    };
  } catch (error) {
    process.kill("SIGKILL");
    await process.exited;
    const stderr = await errors;
    throw new Error(`Native crash fixture failed: ${stderr || String(error)}`, { cause: error });
  } finally {
    process.kill();
    process.stdin.end();
    await process.exited;
    reader.releaseLock();
  }
}
