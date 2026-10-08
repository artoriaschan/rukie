const fullHeader = "Deferred MCP tools (use ToolSearch to load their definitions):";
const deltaHeader = "Deferred MCP tools changed:";

/** Prior contents belong to the current Transcript projection, including its compaction baseline. */
export function deferredToolsReminder(
  names: readonly string[],
  history: readonly string[],
): string | undefined {
  const previous = new Set<string>();
  for (const content of history) {
    if (content.startsWith(fullHeader)) previous.clear();
    let remove = false;
    for (const line of content.split("\n")) {
      if (line === "Removed:") remove = true;
      if (line === "Added:") remove = false;
      if (!line.startsWith("- ")) continue;
      const name = line.slice(2);
      if (remove) previous.delete(name);
      else previous.add(name);
    }
  }
  if (!history.length) {
    if (!names.length) return;
    return `${fullHeader}\n${names.map((name) => `- ${name}`).join("\n")}`;
  }
  const current = new Set(names);
  const added = names.filter((name) => !previous.has(name));
  const removed = [...previous].filter((name) => !current.has(name));
  if (!added.length && !removed.length) return;
  return [
    deltaHeader,
    ...(added.length ? ["Added:", ...added.map((name) => `- ${name}`)] : []),
    ...(removed.length ? ["Removed:", ...removed.map((name) => `- ${name}`)] : []),
  ].join("\n");
}
