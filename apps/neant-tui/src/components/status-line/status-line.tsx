import { Text } from "@neant/tui";

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
    <Text
      dimColor
    >{`${model} · input ${input} · output ${output} · ${running ? "Running" : "Ready"}`}</Text>
  );
}
