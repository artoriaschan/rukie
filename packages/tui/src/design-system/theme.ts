export interface Theme {
  text: `#${string}`;
  subtle: `#${string}`;
  accent: `#${string}`;
  activity: `#${string}`;
  activityFlash: `#${string}`;
  permission: `#${string}`;
  success: `#${string}`;
  error: `#${string}`;
  warning: `#${string}`;
  promptBorder: `#${string}`;
  logoFrom: `#${string}`;
  logoTo: `#${string}`;
}

export const dark: Theme = {
  text: "#E8E6E0",
  subtle: "#5E6673",
  accent: "#7DA1DE",
  activity: "#7DA1DE",
  activityFlash: "#C6D8F8",
  permission: "#ABC2EC",
  success: "#82B89D",
  error: "#DA8A93",
  warning: "#D8B270",
  promptBorder: "#55606F",
  logoFrom: "#7DA1DE",
  logoTo: "#D7E4FF",
};
