import type { WireSessionSummary, WireProject } from "@rukie/shared";

/** Derive navigation ownership without changing Session summaries or persisted ordering. */
export function sessionGroups(
  sessions: WireSessionSummary[],
  projects: WireProject[],
  pinned: string[],
  archived: string[] = [],
  pinnedProjects: string[] = [],
) {
  const hidden = new Set(archived);
  const pins = new Set(pinned);
  const visible = sessions.filter((session) => !hidden.has(session.id));
  const remaining = visible.filter((session) => !pins.has(session.id));
  const owners = new Set(projects.map((project) => project.id));
  const group = (project: WireProject) => ({
    project,
    sessions: remaining.filter((session) => session.projectId === project.id),
  });
  // Pinned Projects keep their pin order; ids of removed Projects are ignored.
  const pinnedGroups = pinnedProjects.flatMap((id) => {
    const project = projects.find((candidate) => candidate.id === id);
    return project ? [group(project)] : [];
  });
  const pinnedIds = new Set(pinnedGroups.map(({ project }) => project.id));
  return {
    pinned: visible.filter((session) => pins.has(session.id)),
    pinnedProjects: pinnedGroups,
    projects: projects.filter((project) => !pinnedIds.has(project.id)).map(group),
    conversations: remaining.filter((session) => !owners.has(session.projectId ?? "")),
  };
}
