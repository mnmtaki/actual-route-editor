import type { ActualRouteProject, ProjectSettings } from '../data/model'
import { DEFAULT_SETTINGS } from '../data/model'

type LegacySettings = Partial<ProjectSettings> & { stationDiameterRatio?: number }

export function parseProjectJson(text: string): ActualRouteProject {
  const parsed = JSON.parse(text) as Partial<ActualRouteProject>
  if (parsed.version !== 1 || !Array.isArray(parsed.stations) || !Array.isArray(parsed.lines) || !Array.isArray(parsed.geometry?.segments)) throw new Error('不是受支持的实际走向工程 JSON')
  const today = new Date().toISOString().slice(0, 10)
  const raw = (parsed.settings ?? {}) as LegacySettings
  const settings: ProjectSettings = {
    lineWidth: finiteOr(raw.lineWidth, DEFAULT_SETTINGS.lineWidth),
    stationSize: finiteOr(raw.stationSize, DEFAULT_SETTINGS.stationSize),
    stationStyleId: typeof raw.stationStyleId === 'string' && raw.stationStyleId ? raw.stationStyleId : DEFAULT_SETTINGS.stationStyleId,
    transferHeightRatio: finiteOr(raw.transferHeightRatio, DEFAULT_SETTINGS.transferHeightRatio),
    transferGapRatio: finiteOr(raw.transferGapRatio, DEFAULT_SETTINGS.transferGapRatio),
    transferPaddingRatio: finiteOr(raw.transferPaddingRatio, DEFAULT_SETTINGS.transferPaddingRatio),
    labelsVisible: raw.labelsVisible !== false,
    gridVisible: raw.gridVisible !== false,
    exportBackground: raw.exportBackground !== false,
  }
  return {
    version: 1,
    name: typeof parsed.name === 'string' ? parsed.name : '恢复的实际走向工程',
    stations: parsed.stations.map(station => ({ ...station, labelOffsetX: Number.isFinite(station.labelOffsetX) ? station.labelOffsetX : 14, labelOffsetY: Number.isFinite(station.labelOffsetY) ? station.labelOffsetY : -14 })),
    lines: parsed.lines.map((line, index) => ({ ...line, stationSequence: Array.isArray(line.stationSequence) ? line.stationSequence : [], lineOrder: Number.isFinite(line.lineOrder) ? line.lineOrder : index, visible: line.visible !== false, locked: line.locked === true })),
    stationLineRelations: Array.isArray(parsed.stationLineRelations) ? parsed.stationLineRelations : [],
    geometry: { segments: parsed.geometry.segments.map(segment => ({ ...segment, mode: segment.mode ?? 'straight', waypoints: Array.isArray(segment.waypoints) ? segment.waypoints : [] })) },
    background: parsed.background ?? null,
    timeline: { currentDate: parsed.timeline?.currentDate ?? today, startDate: parsed.timeline?.startDate ?? today, endDate: parsed.timeline?.endDate ?? today, playing: false },
    settings,
  }
}

const finiteOr = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
export const serializeProject = (project: ActualRouteProject) => JSON.stringify(project, null, 2)
export function downloadText(filename: string, text: string, type: string) { const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url) }
