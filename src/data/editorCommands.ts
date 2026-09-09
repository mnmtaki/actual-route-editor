import type { ActualRouteProject } from './model'
import { withoutBackground } from './background'

/**
 * Shared, pure project commands used by both desktop and mobile entry points.
 *
 * UI components decide how an action is invoked (mouse, touch, button, or
 * keyboard), but never need to own the project mutation itself.  Every command
 * returns a new project snapshot and leaves the caller to decide whether that
 * snapshot is transient or should be committed to history.
 */

export type LineBooleanField = 'visible' | 'locked'

export function setLineBoolean(
  project: ActualRouteProject,
  lineId: string,
  field: LineBooleanField,
  value: boolean,
): ActualRouteProject {
  const line = project.lines.find((item) => item.id === lineId)
  if (!line || line[field] === value) return project
  const next = structuredClone(project)
  const target = next.lines.find((item) => item.id === lineId)
  if (target) target[field] = value
  return next
}

export function setLineVisibility(
  project: ActualRouteProject,
  lineId: string,
  visible: boolean,
): ActualRouteProject {
  return setLineBoolean(project, lineId, 'visible', visible)
}

export function setLineLocked(
  project: ActualRouteProject,
  lineId: string,
  locked: boolean,
): ActualRouteProject {
  return setLineBoolean(project, lineId, 'locked', locked)
}

export function setLinesBoolean(
  project: ActualRouteProject,
  lineIds: Iterable<string>,
  field: LineBooleanField,
  value: boolean,
): ActualRouteProject {
  const ids = new Set(lineIds)
  if (!ids.size) return project
  const targets = project.lines.filter((line) => ids.has(line.id))
  if (!targets.length || targets.every((line) => line[field] === value)) return project
  const next = structuredClone(project)
  next.lines.forEach((line) => {
    if (ids.has(line.id)) line[field] = value
  })
  return next
}

export function setLinesVisibility(
  project: ActualRouteProject,
  lineIds: Iterable<string>,
  visible: boolean,
): ActualRouteProject {
  return setLinesBoolean(project, lineIds, 'visible', visible)
}

export function setLinesLocked(
  project: ActualRouteProject,
  lineIds: Iterable<string>,
  locked: boolean,
): ActualRouteProject {
  return setLinesBoolean(project, lineIds, 'locked', locked)
}

/** Shared basemap removal command used by desktop and mobile hosts. */
export function removeBackground(project: ActualRouteProject): ActualRouteProject {
  return project.background ? withoutBackground(project) : project
}
