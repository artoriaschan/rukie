import { ThemedText } from "@neant/tui";

export function StatusLine({
  model,
  input,
  output,
  running,
}: {
  model: string;
  input: number;
  output: number;
  running: boolean;
}) {
  return (
    <ThemedText color="subtle">
      {`${model} · input ${input} · output ${output} · `}
      <ThemedText color={running ? "accent" : "subtle"}>{running ? "Running" : "Ready"}</ThemedText>
    </ThemedText>
  );
}
