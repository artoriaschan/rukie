import type { WireSessionSummary, WireProject } from "@rukie/shared";

/** Derive navigation ownership without changing Session summaries or persisted ordering. */
export function sessionGroups(
  sessions: WireSessionSummary[],
  projects: WireProject[],
  pinned: string[],
  archived: string[] = [],
) {
  const hidden = new Set(archived);
  const pins = new Set(pinned);
  const visible = sessions.filter((session) => !hidden.has(session.id));
  const remaining = visible.filter((session) => !pins.has(session.id));
  const paths = new Set(projects.flatMap((project) => project.directories));
  return {
    pinned: visible.filter((session) => pins.has(session.id)),
    projects: projects.map((project) => ({
      project,
      sessions: remaining.filter((session) => project.directories.includes(session.cwd)),
    })),
    conversations: remaining.filter((session) => !paths.has(session.cwd)),
  };
}
