import type { ActualRouteProject, Line, Segment } from '../data/model'
import { reconstructAarcLineGeometry, type AarcGeometryPoint } from '../import-export/aarcGeometry'
import { buildRoundedPolylineSpans, pathSpansToSvgPath } from '../geometry/path'
import { effectiveLineWidth } from '../data/style'
import { resolveLineStyle } from '../data/lineStyles'
import { SegmentArtwork } from './segmentStyles'

interface RawAarcLine extends Record<string, unknown> {
  id?: unknown
  pts?: unknown
  type?: unknown
  isFake?: unknown
}
interface RawAarcPoint extends Record<string, unknown> {
  id?: unknown
  pos?: unknown
  dir?: unknown
  sta?: unknown
  free?: unknown
}

export interface AarcTerminalExtension {
  id: string
  lineId: string
  sourceLineId: number
  kind: 'head' | 'tail' | 'full'
  path: string
}

const finite = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}
const pair = (value: unknown): [number, number] | undefined => {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const x = finite(value[0]), y = finite(value[1])
  return x === undefined || y === undefined ? undefined : [x, y]
}
function rawLines(project: ActualRouteProject): RawAarcLine[] {
  const value = project.aarc?.raw?.lines
  return Array.isArray(value) ? value.filter((item): item is RawAarcLine => Boolean(item && typeof item === 'object')) : []
}
function rawPoints(project: ActualRouteProject): RawAarcPoint[] {
  const value = project.aarc?.raw?.points
  return Array.isArray(value) ? value.filter((item): item is RawAarcPoint => Boolean(item && typeof item === 'object')) : []
}

function extensionPath(nodes: Array<{ x: number; y: number }>, radius: number) {
  if (nodes.length < 2) return ''
  return pathSpansToSvgPath(buildRoundedPolylineSpans(nodes, radius))
}

/**
 * ActualRoute stores passenger rail geometry station-to-station, while AARC
 * permits ordinary control points before the first station and after the last
 * station. Keep those source tails as supplemental artwork instead of silently
 * dropping them during import.
 */
export function getAarcTerminalExtensions(project: ActualRouteProject, line: Line): AarcTerminalExtension[] {
  if (line.source?.format !== 'aarc' || line.isFake) return []
  const sourceLineId = finite(line.source.sourceLineId ?? line.source.lineId)
  if (sourceLineId === undefined) return []
  const sourceLine = rawLines(project).find(item => finite(item.id) === sourceLineId)
  if (!sourceLine || sourceLine.isFake === true || Number(sourceLine.type ?? 0) === 1 || !Array.isArray(sourceLine.pts)) return []

  const pointById = new Map(rawPoints(project).flatMap(point => {
    const id = finite(point.id)
    return id === undefined ? [] : [[id, point] as const]
  }))
  const geometryPoints: AarcGeometryPoint[] = sourceLine.pts.flatMap(value => {
    const id = finite(value), raw = id === undefined ? undefined : pointById.get(id), pos = raw ? pair(raw.pos) : undefined
    if (id === undefined || !raw || !pos) return []
    return [{ id, x: pos[0], y: pos[1], dir: finite(raw.dir) === 1 ? 1 as const : 0 as const, station: finite(raw.sta) === 1, ...(raw.free === true ? { free: true } : {}) }]
  })
  if (geometryPoints.length < 2) return []

  const reconstructed = reconstructAarcLineGeometry(geometryPoints)
  const nodes = reconstructed.nodes
  if (nodes.length < 2) return []
  const radius = Math.max(0, finite(project.aarc?.config?.lineTurnAreaRadius) ?? 30)
  const stationSourceIndices = geometryPoints.flatMap((point, index) => point.station ? [index] : [])
  if (!stationSourceIndices.length) {
    const path = extensionPath(nodes, radius)
    return path ? [{ id: `aarc-terminal-${line.id}-full`, lineId: line.id, sourceLineId, kind: 'full', path }] : []
  }

  const firstStationSourceIndex = stationSourceIndices[0]
  const lastStationSourceIndex = stationSourceIndices.at(-1)!
  const nodeIndexForSource = new Map<number, number>()
  nodes.forEach((node, index) => {
    if (node.sourcePointIndex !== undefined) nodeIndexForSource.set(node.sourcePointIndex, index)
  })
  const firstStationNodeIndex = nodeIndexForSource.get(firstStationSourceIndex)
  const lastStationNodeIndex = nodeIndexForSource.get(lastStationSourceIndex)
  const result: AarcTerminalExtension[] = []

  if (firstStationSourceIndex > 0 && firstStationNodeIndex !== undefined) {
    const path = extensionPath(nodes.slice(0, firstStationNodeIndex + 1), radius)
    if (path) result.push({ id: `aarc-terminal-${line.id}-head`, lineId: line.id, sourceLineId, kind: 'head', path })
  }
  if (lastStationSourceIndex < geometryPoints.length - 1 && lastStationNodeIndex !== undefined) {
    const path = extensionPath(nodes.slice(lastStationNodeIndex), radius)
    if (path) result.push({ id: `aarc-terminal-${line.id}-tail`, lineId: line.id, sourceLineId, kind: 'tail', path })
  }
  return result
}

export function AarcTerminalExtensionsLayer({ project, line, opacity = 1 }: { project: ActualRouteProject; line: Line; opacity?: number }) {
  if (!line.visible) return null
  const extensions = getAarcTerminalExtensions(project, line)
  if (!extensions.length) return null
  const lineWidth = effectiveLineWidth(line, project.settings)
  return <g data-aarc-terminal-extensions={line.id} pointerEvents="none">
    {extensions.map(extension => {
      const segment: Segment = {
        id: extension.id,
        lineId: line.id,
        fromStationId: `${extension.id}:from`,
        toStationId: `${extension.id}:to`,
        mode: 'straight',
        structureType: 'underground',
        structureNodes: [],
        waypoints: [],
        openedAt: line.openedAt,
        closedAt: line.closedAt,
      }
      return <g key={extension.id} data-aarc-terminal-extension={extension.kind} data-source-line-id={extension.sourceLineId}>
        <SegmentArtwork segment={segment} line={line} path={extension.path} lineWidth={lineWidth} opacity={opacity} renderLegacyStructure={false} style={resolveLineStyle(project, line, segment)} />
      </g>
    })}
  </g>
}
