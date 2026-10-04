/** Text segmentation only; this deliberately does not parse or execute shell syntax. */
export function analyzeBashCommand(command: string) {
  const text = command.trim();
  const segments: string[] = [];
  let quote: "'" | '"' | undefined;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "\\" && quote !== "'") {
      i++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ";" || char === "|" || char === "&" || char === "\n") {
      const segment = text.slice(start, i).trim();
      if (segment) segments.push(segment);
      if ((char === "|" || char === "&") && text[i + 1] === char) i++;
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) segments.push(last);
  // The spec intentionally treats these markers as uncertain even inside quotes.
  const allowMatching = quote === undefined && !/\$\(|`|<\(|>\(|<</.test(text);
  return { text, segments, allowMatching };
}

export function matchesBashPattern(pattern: string, command: string): boolean {
  // Bash is text: slashes have no directory semantics here.
  return new Bun.Glob(pattern.replaceAll("/", "\u0001")).match(command.replaceAll("/", "\u0001"));
}
