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
  return (
    <ThemedText
      color="subtle"
      wrap="truncate"
    >{`${model} · input ${input} · output ${output}`}</ThemedText>
  );
}
