import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "ui-xs",
        "ui-sm",
        "ui-caption",
        "ui-control",
        "ui-base",
        "ui-lg",
        "ui-xl",
        "ui-loader",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
