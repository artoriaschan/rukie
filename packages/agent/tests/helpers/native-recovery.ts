import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { join } from "node:path";

/** A real process dies after an unsafe effect, before its native ToolResult commit is acknowledged. */
export async function crashUnsafeEffect(root: string, child = false) {
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
      calls.push({ context, tool(name,args) {
        const message = fauxAssistantMessage(fauxToolCall(name,args),{stopReason:"toolUse"});
        stream.push({type:"done",reason:"toolUse",message}); stream.end(message);
      } });
      return stream;
    }});
    const fake = { model: provider.getModel(), models, calls };
    for (const provider of fake.models.getProviders()) fake.models.setProvider({ ...provider, streamSimple(...args) { const stream = provider.streamSimple(...args); changed(); return stream; } });
    const store = createJsonlStore({ cwd: ${JSON.stringify(root)}, homeDir: ${JSON.stringify(root)} });
    let session;
    const wrapped = { ...store, async open(...args) {
      const lease = await store.open(...args);
      return { ...lease, storage: new Proxy(lease.storage, { get(target, key) {
        if (key === "commit") return async (writes, context) => {
          if (writes.some(write => write.type === "entry" && write.value.model?.some(message => message.role === "toolResult" && message.toolName === "write"))) {
            const identities = session.toolState("subagents");
            const childId = Array.isArray(identities) ? identities.find(row => row.description === "Unknown child")?.id : undefined;
            process.stdout.write("READY " + JSON.stringify({ sessionId: session.id, childId }) + "\\n");
            return await new Promise(() => {});
          }
          return target.commit(writes, context);
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } }) };
    } };
    session = await createSession({ cwd: ${JSON.stringify(root)}, homeDir: ${JSON.stringify(root)}, ...fake, store: wrapped, permissionMode: "full-access" });
    await session.rename("Native crash fixture");
    session.subscribe(changed);
    void session.run("fixture parent").catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
    await until(() => fake.calls.length === 1);
    const effect = { path: "uncertain-effect.txt", content: "saved effect" };
    if (${child}) {
      fake.calls[0].tool("subagent", { description: "Unknown child", prompt: "native unsafe child", run_in_background: true });
      await until(() => fake.calls.some(call => call.context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("native unsafe child"))));
      const childCall = fake.calls.find(call => call.context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("native unsafe child")));
      childCall.tool("write", effect);
    } else fake.calls[0].tool("write", effect);
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
    const childId =
      "childId" in value && typeof value.childId === "string" ? value.childId : undefined;
    if (child && !childId) throw new Error("Native child identity missing at effect commit");
    process.kill("SIGKILL");
    await process.exited;
    const stderr = await errors;
    if (stderr) throw new Error(stderr);
    return { sessionId: value.sessionId, childId };
  } finally {
    process.kill();
    process.stdin.end();
    await process.exited;
    reader.releaseLock();
  }
}
