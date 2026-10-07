import { useEffect, useState } from "react";
import { Box, Text } from "../../../ink/index.ts";
import {
  SPIRIT_FRAMES,
  SPIRIT_HEIGHT,
  SPIRIT_PALETTE,
  SPIRIT_WIDTH,
  type SpiritPose,
} from "./spirit-frames";

interface Segment {
  text: string;
  color?: `#${string}`;
  backgroundColor?: `#${string}`;
}

/** Two vertical palette pixels share one styled cell, without embedding control bytes in Text. */
function spriteRows(grid: readonly string[]) {
  return Array.from({ length: SPIRIT_HEIGHT }, (_, row) => {
    const segments: Segment[] = [];
    for (let x = 0; x < SPIRIT_WIDTH; x++) {
      const upper = SPIRIT_PALETTE[grid[row * 2]![x]!];
      const lower = SPIRIT_PALETTE[grid[row * 2 + 1]![x]!];
      const color = upper ?? lower;
      const backgroundColor = upper && lower ? lower : undefined;
      const text = upper ? "▀" : lower ? "▄" : " ";
      const previous = segments.at(-1);
      if (previous && previous.color === color && previous.backgroundColor === backgroundColor)
        previous.text += text;
      else segments.push({ text, color, backgroundColor });
    }
    return segments;
  });
}

const rendered = {
  standard: spriteRows(SPIRIT_FRAMES.standard),
  blink: spriteRows(SPIRIT_FRAMES.blink),
  float: spriteRows(SPIRIT_FRAMES.float),
};

const opening: readonly { pose: SpiritPose; ms: number }[] = [
  { pose: "standard", ms: 400 },
  { pose: "blink", ms: 160 },
  { pose: "standard", ms: 240 },
  { pose: "float", ms: 240 },
  { pose: "standard", ms: 240 },
  { pose: "float", ms: 240 },
  { pose: "standard", ms: 400 },
];
const idle: readonly { pose: SpiritPose; ms: number }[] = [
  { pose: "standard", ms: 3500 },
  { pose: "blink", ms: 160 },
  { pose: "standard", ms: 1200 },
  { pose: "float", ms: 350 },
];

/** Like dsh-TUI's welcome mascot, the first Run freezes it for the rest of this mount. */
export function useSpiritPose(visible: boolean, working: boolean) {
  const [frozen, setFrozen] = useState(working);
  const [opened, setOpened] = useState(false);
  const [pose, setPose] = useState<SpiritPose>("standard");
  useEffect(() => {
    if (working) setFrozen(true);
  }, [working]);
  useEffect(() => {
    if (!visible || working || frozen) return;
    const sequence = opened ? idle : opening;
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (step >= sequence.length) {
        if (sequence === opening) {
          setOpened(true);
          return;
        }
        step = 0;
      }
      const current = sequence[step++]!;
      setPose(current.pose);
      timer = setTimeout(tick, current.ms);
      timer.unref();
    };
    tick();
    return () => clearTimeout(timer);
  }, [visible, working, frozen, opened]);
  return working || frozen || !visible ? "standard" : pose;
}

export function SpiritArt({ pose }: { pose: SpiritPose }) {
  return (
    <Box width={SPIRIT_WIDTH} height={SPIRIT_HEIGHT} flexDirection="column" flexShrink={0}>
      {rendered[pose].map((segments, row) => (
        <Text key={row} wrap="truncate" preserveWhitespace>
          {segments.map((segment, x) => (
            <Text key={x} color={segment.color} backgroundColor={segment.backgroundColor}>
              {segment.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
