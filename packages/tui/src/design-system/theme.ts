export interface Theme {
  text: `#${string}`;
  subtle: `#${string}`;
  accent: `#${string}`;
  remember: `#${string}`;
  suggestion: `#${string}`;
  inactive: `#${string}`;
  toolNameMutate: `#${string}`;
  toolNameExec: `#${string}`;
  inverseText: `#${string}`;
  badgeBackground: `#${string}`;
  badgeHoverBackground: `#${string}`;
  activity: `#${string}`;
  activityFlash: `#${string}`;
  permission: `#${string}`;
  plan: `#${string}`;
  success: `#${string}`;
  error: `#${string}`;
  warning: `#${string}`;
  promptBorder: `#${string}`;
  userPromptLabel: `#${string}`;
  logoFrom: `#${string}`;
  logoTo: `#${string}`;
  barSystem: `#${string}`;
  barPrompt: `#${string}`;
  barAssistant: `#${string}`;
  barThinking: `#${string}`;
  barTools: `#${string}`;
  barFree: `#${string}`;
  barFreeText: `#${string}`;
}

export const dark: Theme = {
  text: "#E8E6E0",
  subtle: "#5E6673",
  accent: "#7DA1DE",
  remember: "#ABC2EC",
  suggestion: "#ABC2EC",
  inactive: "#8D95A6",
  toolNameMutate: "#E5C07B",
  toolNameExec: "#56B6C2",
  inverseText: "#22262E",
  badgeBackground: "#5E88CC",
  badgeHoverBackground: "#3B5BDB",
  activity: "#7DA1DE",
  activityFlash: "#C6D8F8",
  permission: "#ABC2EC",
  plan: "#B49ADC",
  success: "#82B89D",
  error: "#DA8A93",
  warning: "#D8B270",
  promptBorder: "#55606F",
  userPromptLabel: "#FFDF80",
  logoFrom: "#7DA1DE",
  logoTo: "#D7E4FF",
  barSystem: "#22305F",
  barPrompt: "#2B3D78",
  barAssistant: "#344A92",
  barThinking: "#4D6BFE",
  barTools: "#5A7CFF",
  barFree: "#2E3440",
  barFreeText: "#8D95A6",
};

/** Light surfaces can supply this palette through ThemeProvider. */
export const light: Theme = {
  text: "#292C33",
  subtle: "#6C7280",
  accent: "#345C9C",
  remember: "#27478C",
  suggestion: "#3F6CC4",
  inactive: "#8991A0",
  toolNameMutate: "#8C6118",
  toolNameExec: "#257B87",
  inverseText: "#FFFFFF",
  badgeBackground: "#4069AD",
  badgeHoverBackground: "#31539B",
  activity: "#345C9C",
  activityFlash: "#5E80BD",
  permission: "#4569A0",
  plan: "#7856A8",
  success: "#397B59",
  error: "#B74450",
  warning: "#91631D",
  promptBorder: "#A4ADB9",
  userPromptLabel: "#906A16",
  logoFrom: "#345C9C",
  logoTo: "#6687BD",
  barSystem: "#AFBEDD",
  barPrompt: "#97AED7",
  barAssistant: "#7897C8",
  barThinking: "#5675CE",
  barTools: "#486BBD",
  barFree: "#E2E6ED",
  barFreeText: "#535E72",
};
