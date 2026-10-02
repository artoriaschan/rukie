import { ThemedText } from "@neant/tui";

export function StatusLine({
  model,
  input,
  output,
}: {
  model: string;
  input: number;
  output: number;
}) {
  return <ThemedText color="subtle">{`${model} · input ${input} · output ${output}`}</ThemedText>;
}
