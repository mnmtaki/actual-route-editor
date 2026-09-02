import type { ActualRouteProject } from './model'

/** Remove the imported basemap while preserving every other project field. */
export function withoutBackground(project: ActualRouteProject): ActualRouteProject {
  const next = structuredClone(project)
  next.background = null
  return next
}
