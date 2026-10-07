import Text, { type Props as TextProps } from "../components/Text";
import { useAnimationFrame } from "../hooks/use-animation-frame";
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export type SpinnerProps = Omit<TextProps, "children"> & { frames?: readonly string[] };
/** Product spinner; the native clock pauses it outside the painted viewport. */
export function Spinner({ frames = spinnerFrames, bold, dim, ...props }: SpinnerProps) {
  const [ref, time] = useAnimationFrame(80);
  return (
    <Text {...props} {...(bold !== undefined ? { bold } : { dim: dim ?? false })} ref={ref}>
      {frames[Math.floor(time / 80) % frames.length]}
    </Text>
  );
}
