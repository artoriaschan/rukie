import { useEffect, useState } from "react";
import { Box, Text } from "../../../ink/index.ts";
import {
  AVATAR_FRAMES,
  AVATAR_HEIGHT,
  AVATAR_PALETTE,
  AVATAR_WIDTH,
  type AvatarPose,
} from "./avatar-frames";

interface Segment {
  text: string;
  color?: `#${string}`;
  backgroundColor?: `#${string}`;
}

/** Two vertical palette pixels share one styled cell, without embedding control bytes in Text. */
function spriteRows(grid: readonly string[]) {
  return Array.from({ length: AVATAR_HEIGHT }, (_, row) => {
    const segments: Segment[] = [];
    for (let x = 0; x < AVATAR_WIDTH; x++) {
      const upper = AVATAR_PALETTE[grid[row * 2]![x]!];
      const lower = AVATAR_PALETTE[grid[row * 2 + 1]![x]!];
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
  standard: spriteRows(AVATAR_FRAMES.standard),
  blink: spriteRows(AVATAR_FRAMES.blink),
  nod: spriteRows(AVATAR_FRAMES.nod),
};

const opening: readonly { pose: AvatarPose; ms: number }[] = [
  { pose: "standard", ms: 400 },
  { pose: "blink", ms: 160 },
  { pose: "standard", ms: 240 },
  { pose: "nod", ms: 240 },
  { pose: "standard", ms: 240 },
  { pose: "nod", ms: 240 },
  { pose: "standard", ms: 400 },
];
const idle: readonly { pose: AvatarPose; ms: number }[] = [
  { pose: "standard", ms: 3500 },
  { pose: "blink", ms: 160 },
  { pose: "standard", ms: 1200 },
  { pose: "nod", ms: 350 },
];

/** Like dsh-TUI's welcome mascot, the first Run freezes it for the rest of this mount. */
export function useAvatarPose(visible: boolean, working: boolean) {
  const [frozen, setFrozen] = useState(working);
  const [opened, setOpened] = useState(false);
  const [pose, setPose] = useState<AvatarPose>("standard");
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

export function AvatarArt({ pose }: { pose: AvatarPose }) {
  return (
    <Box width={AVATAR_WIDTH} height={AVATAR_HEIGHT} flexDirection="column" flexShrink={0}>
      {rendered[pose].map((segments, row) => (
        <Text key={row} wrap="truncate">
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
