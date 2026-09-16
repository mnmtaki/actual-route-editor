import type { ActualRouteProject, StylePointStyleState } from '../data/model'
import { parseProjectJson as parseLegacyProjectJson, serializeProject, downloadText } from './projectJsonLegacy'

export { serializeProject, downloadText }

/** Keep the established project normalizer intact, then restore the style-point state introduced after that schema was written. */
export function parseProjectJson(text: string): ActualRouteProject {
  const raw = JSON.parse(text) as { geometry?: { segments?: unknown[] } }
  const project = parseLegacyProjectJson(text)
  const rawSegments = Array.isArray(raw.geometry?.segments) ? raw.geometry!.segments! : []
  const rawSegmentById = new Map<string, Record<string, unknown>>()
  for (const value of rawSegments) {
    if (!value || typeof value !== 'object') continue
    const segment = value as Record<string, unknown>
    if (typeof segment.id === 'string') rawSegmentById.set(segment.id, segment)
  }
  for (const segment of project.geometry.segments) {
    const rawSegment = rawSegmentById.get(segment.id)
    if (rawSegment?.mode === 'corner') segment.mode = 'straight'
    const rawNodes = Array.isArray(rawSegment?.structureNodes) ? rawSegment!.structureNodes as unknown[] : []
    const rawNodeById = new Map<string, Record<string, unknown>>()
    for (const value of rawNodes) {
      if (!value || typeof value !== 'object') continue
      const node = value as Record<string, unknown>
      if (typeof node.id === 'string') rawNodeById.set(node.id, node)
    }
    for (const node of segment.structureNodes ?? []) {
      const source = rawNodeById.get(node.id)
      if (!source || !Object.prototype.hasOwnProperty.call(source, 'styleAfter')) continue
      const rawStyle = source.styleAfter
      if (!rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) { node.styleAfter = {}; continue }
      const value = rawStyle as Record<string, unknown>
      const styleAfter: StylePointStyleState = {}
      if (value.lineStyleId === null) styleAfter.lineStyleId = null
      else if (typeof value.lineStyleId === 'string' && value.lineStyleId) styleAfter.lineStyleId = value.lineStyleId
      node.styleAfter = styleAfter
    }
  }
  return project
}
