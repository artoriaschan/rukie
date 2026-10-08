import { afterEach, expect, setSystemTime, test } from "bun:test";
import { join } from "node:path";
import { Type } from "typebox";
import { fauxAssistantMessage, type Context } from "@earendil-works/pi-ai";
import { loadSettings, resolveModel } from "../../src/config/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { wireResponse } from "../helpers/model-wire.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let server: ReturnType<typeof Bun.serve> | undefined;
const key = "RUKIE_CAPABILITY_TEST_KEY";
const previous = process.env[key];
afterEach(async () => {
  setSystemTime();
  server?.stop(true);
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
  await dirs?.cleanup();
});
const context: Context = {
  messages: [
    {
      role: "system",
      content: "test",
      timestamp: 0,
      toolsAdded: [{ name: "initial", description: "initial", parameters: Type.Object({}) }],
    },
    { role: "user", content: "prepare", timestamp: 1 },
    fauxAssistantMessage("ready"),
    {
      role: "system",
      content: "",
      timestamp: 3,
      toolsAdded: [{ name: "echo", description: "echo", parameters: Type.Object({}) }],
    },
    { role: "user", content: "use echo", timestamp: 4 },
  ],
};
async function setup(handler: (body: string) => Response | Promise<Response>, compat?: object) {
  dirs = await tempDirs();
  process.env[key] = "test-key";
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      return handler(await request.text());
    },
  });
  await Bun.write(
    join(dirs.homeDir, ".rukie/settings.json"),
    JSON.stringify({
      model: "custom/m",
      providers: [
        {
          id: "custom",
          api: "openai-responses",
          baseUrl: server.url.origin,
          apiKeyEnv: key,
          models: [{ id: "m", compat }],
        },
      ],
    }),
  );
  const { settings } = await loadSettings(dirs);
  return resolveModel(settings, dirs.homeDir);
}
const rejection = () =>
  Response.json({ error: { message: "unsupported tool_search_output" } }, { status: 422 });
const isProbe = (body: string) => body.includes("rukie_native_tool_probe");
const isNative = (body: string) => body.includes('"type":"tool_search_output"');
async function cache() {
  return Bun.file(join(dirs.homeDir, ".rukie/model-capabilities.json")).text();
}

test.each([422, 401, 429, 500])(
  "probe HTTP %i falls back; only format rejection is unsupported",
  async (status) => {
    let probes = 0;
    let native = false;
    const { model, models } = await setup((body) => {
      if (isProbe(body)) {
        probes++;
        return Response.json({ error: { message: "unsupported tool_search_output" } }, { status });
      }
      native = isNative(body);
      return wireResponse("openai-responses", false);
    });
    expect((await models.completeSimple(model, context)).stopReason).toBe("stop");
    await models.completeSimple(model, context);
    expect(probes).toBe(1);
    expect(native).toBe(false);
    expect(await cache()).toContain(
      status === 422 ? '"outcome":"unsupported"' : '"outcome":"unknown"',
    );
    expect(model.compat).toBeUndefined();
  },
);

test("a definitive native request rejection retries once and caches fallback", async () => {
  let probes = 0;
  const actual: boolean[] = [];
  const { model, models } = await setup((body) => {
    if (isProbe(body)) {
      probes++;
      return wireResponse("openai-responses", true, "rukie_native_tool_probe", {});
    }
    actual.push(isNative(body));
    return isNative(body) ? rejection() : wireResponse("openai-responses", false);
  });
  expect((await models.completeSimple(model, context)).stopReason).toBe("stop");
  await models.completeSimple(model, context);
  expect(actual).toEqual([true, false, false]);
  expect(probes).toBe(1);
  expect(await cache()).toContain('"reason":"native-request-format-rejected"');
});

test("ordinary task failures are not retried as protocol incompatibility", async () => {
  let actual = 0;
  const { model, models } = await setup((body) => {
    if (isProbe(body)) return wireResponse("openai-responses", true, "rukie_native_tool_probe", {});
    actual++;
    return Response.json(
      { error: { message: "unauthorized tool_search_output" } },
      { status: 401 },
    );
  });
  expect((await models.completeSimple(model, context, { maxRetries: 0 })).stopReason).toBe("error");
  expect(actual).toBe(1);
  expect(await cache()).toContain('"outcome":"supported"');
});

test.each([true, false])("explicit native compat=%s bypasses detection", async (enabled) => {
  const bodies: string[] = [];
  const { model, models } = await setup(
    (body) => {
      bodies.push(body);
      return wireResponse("openai-responses", false);
    },
    { supportsToolSearch: enabled, supportsMidConvoSystemMessages: enabled },
  );
  await models.completeSimple(model, context);
  expect(bodies).toHaveLength(1);
  expect(isProbe(bodies[0]!)).toBe(false);
  expect(isNative(bodies[0]!)).toBe(enabled);
});

test("unknown capability expires and concurrent requests share a new probe", async () => {
  let probes = 0;
  const { model, models } = await setup((body) => {
    if (isProbe(body)) {
      probes++;
      return wireResponse("openai-responses", false);
    }
    return wireResponse("openai-responses", false);
  });
  await models.completeSimple(model, context);
  setSystemTime(new Date(Date.now() + 60_001));
  await Promise.all([models.completeSimple(model, context), models.completeSimple(model, context)]);
  expect(probes).toBe(2);
});

test("credentials isolate capability results and no additions means no probe", async () => {
  let probes = 0;
  const { model, models } = await setup((body) => {
    if (isProbe(body)) {
      probes++;
      return rejection();
    }
    return wireResponse("openai-responses", false);
  });
  await models.completeSimple(model, {
    messages: [{ role: "user", content: "hello", timestamp: 0 }],
  });
  expect(probes).toBe(0);
  await models.completeSimple(model, context);
  process.env[key] = "other-key";
  await models.completeSimple(model, context);
  expect(probes).toBe(2);
  expect(await cache()).not.toContain("other-key");
});

test("aborting a probe cancels the caller and permits detection on the next request", async () => {
  let probes = 0;
  let observed: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { model, models } = await setup(async (body) => {
    if (isProbe(body)) {
      probes++;
      if (probes === 1) {
        observed();
        await released;
      }
      return wireResponse("openai-responses", true, "rukie_native_tool_probe", {});
    }
    return wireResponse("openai-responses", false);
  });
  const controller = new AbortController();
  const answer = models.completeSimple(model, context, { signal: controller.signal });
  try {
    await started;
    controller.abort();
    expect((await answer).stopReason).toBe("aborted");
  } finally {
    release();
  }
  expect((await models.completeSimple(model, context)).stopReason).toBe("stop");
  expect(probes).toBe(2);
});

test("a partially specified explicit flag is preserved when detection is inconclusive", async () => {
  let probes = 0;
  let native = true;
  const { model, models } = await setup(
    (body) => {
      if (isProbe(body)) {
        probes++;
        return wireResponse("openai-responses", false);
      }
      native = isNative(body);
      return wireResponse("openai-responses", false);
    },
    { supportsToolSearch: true },
  );
  await models.completeSimple(model, context);
  expect(probes).toBe(1);
  expect(native).toBe(false);
  expect(model.compat).toMatchObject({ supportsToolSearch: true });
});

test("probe callbacks and usage remain separate from task telemetry", async () => {
  let payloads = 0;
  let responses = 0;
  let probeBody = "";
  const { model, models } = await setup((body) => {
    if (isProbe(body)) {
      probeBody = body;
      return wireResponse("openai-responses", true, "rukie_native_tool_probe", {});
    }
    return wireResponse("openai-responses", false);
  });
  const answer = await models.completeSimple(model, context, {
    onPayload: () => {
      payloads++;
    },
    onResponse: () => {
      responses++;
    },
  });
  expect(payloads).toBe(1);
  expect(responses).toBe(1);
  expect(answer.usage.input).toBe(10);
  expect(probeBody).toContain('"max_output_tokens":256');
  expect(await cache()).toContain('"input":10');
});
