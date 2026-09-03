import type { ActualRouteProject, LabelDirection, LineBadge, LineStyleOverrides, MapElement, PresentationSettings, ProjectSettings, StationStyleOverrides } from '../data/model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from '../data/model'
import { normalizeFontFamily, normalizeFontWeight, normalizeHexColor } from '../data/style'
import { normalizeISODate, normalizeRequiredDate } from '../timeline/date'
import { normalizeStationNameHistory, syncStationNameFromHistory } from '../data/stationNameHistory'
import { normalizeSegmentLineHistory } from '../data/segmentLineHistory'
import { normalizeLineStyles } from '../data/lineStyles'
import { normalizeBasemapPaths } from '../data/basemapPaths'
import { normalizeRoadStyles, normalizeRoads } from '../data/roads'
import { normalizeLineLegend } from '../data/lineLegend'

type LegacySettings = Partial<ProjectSettings> & { stationDiameterRatio?: number }

export function parseProjectJson(text: string): ActualRouteProject {
  const parsed = JSON.parse(text) as Partial<ActualRouteProject>
  if (parsed.version !== 1 || !Array.isArray(parsed.stations) || !Array.isArray(parsed.lines) || !Array.isArray(parsed.geometry?.segments)) throw new Error('不是受支持的实际走向工程 JSON')
  const normalizedStyles = normalizeLineStyles((parsed as Record<string, unknown>).styles)
  const today = new Date().toISOString().slice(0, 10)
  const raw = (parsed.settings ?? {}) as LegacySettings
  const typographyFallback = legacyTypographyFallback(parsed.stations)
  const lineWidth = positiveOr(raw.lineWidth, DEFAULT_SETTINGS.lineWidth)
  const stationSize = positiveOr(raw.stationSize, DEFAULT_SETTINGS.stationSize)
  const hasLegacyTransferSettings = [raw.transferHeightRatio,raw.transferGapRatio,raw.transferPaddingRatio].some(value=>typeof value==='number'&&Number.isFinite(value))
  const isBuild11Default = !hasLegacyTransferSettings || (approximately(raw.transferHeightRatio, 1.0833333333333333) && approximately(raw.transferGapRatio, 0.1944) && approximately(raw.transferPaddingRatio, 0.25))
  const settings: ProjectSettings = {
    lineWidth,
    stationSize,
    stationStyleId: typeof raw.stationStyleId === 'string' && raw.stationStyleId ? raw.stationStyleId : DEFAULT_SETTINGS.stationStyleId,
    transferMinorAxis: positiveOr(raw.transferMinorAxis, isBuild11Default ? DEFAULT_SETTINGS.transferMinorAxis : Math.max(stationSize + 4, lineWidth * positiveOr(raw.transferHeightRatio, DEFAULT_SETTINGS.transferHeightRatio))),
    transferEndPadding: nonNegativeOr(raw.transferEndPadding, isBuild11Default ? DEFAULT_SETTINGS.transferEndPadding : Math.max(2.5, stationSize * nonNegativeOr(raw.transferPaddingRatio, DEFAULT_SETTINGS.transferPaddingRatio))),
    transferDotGap: nonNegativeOr(raw.transferDotGap, isBuild11Default ? DEFAULT_SETTINGS.transferDotGap : Math.max(2, stationSize * nonNegativeOr(raw.transferGapRatio, DEFAULT_SETTINGS.transferGapRatio))),
    stationLabelSize: positiveOr(raw.stationLabelSize, DEFAULT_SETTINGS.stationLabelSize),
    stationLabelFontFamily: normalizeFontFamily(raw.stationLabelFontFamily) ?? typographyFallback.stationLabelFontFamily,
    stationLabelFontWeight: normalizeFontWeight(raw.stationLabelFontWeight) ?? typographyFallback.stationLabelFontWeight,
    stationLabelColor: normalizeHexColor(raw.stationLabelColor) ?? typographyFallback.stationLabelColor,
    stationForeignLabelSize: positiveOr(raw.stationForeignLabelSize, DEFAULT_SETTINGS.stationForeignLabelSize),
    stationForeignLabelFontFamily: normalizeFontFamily(raw.stationForeignLabelFontFamily) ?? typographyFallback.stationForeignLabelFontFamily,
    stationForeignLabelFontWeight: normalizeFontWeight(raw.stationForeignLabelFontWeight) ?? typographyFallback.stationForeignLabelFontWeight,
    stationForeignLabelColor: normalizeHexColor(raw.stationForeignLabelColor) ?? typographyFallback.stationForeignLabelColor,
    foreignLabelGap: nonNegativeOr(raw.foreignLabelGap, DEFAULT_SETTINGS.foreignLabelGap),
    defaultLabelDirection: isLabelDirection(raw.defaultLabelDirection) ? raw.defaultLabelDirection : DEFAULT_SETTINGS.defaultLabelDirection,
    defaultLabelDistance: nonNegativeOr(raw.defaultLabelDistance, DEFAULT_SETTINGS.defaultLabelDistance),
    defaultStationLabelRotation: finiteOr(raw.defaultStationLabelRotation, DEFAULT_SETTINGS.defaultStationLabelRotation),
    transferHeightRatio: restoredTransferSetting(raw.transferHeightRatio, 1.18, DEFAULT_SETTINGS.transferHeightRatio),
    transferGapRatio: restoredTransferSetting(raw.transferGapRatio, 0.202, DEFAULT_SETTINGS.transferGapRatio),
    transferPaddingRatio: finiteOr(raw.transferPaddingRatio, DEFAULT_SETTINGS.transferPaddingRatio),
    labelsVisible: raw.labelsVisible !== false,
    showForeignStationNames: raw.showForeignStationNames !== false,
    gridVisible: raw.gridVisible !== false,
    exportBackground: raw.exportBackground !== false,
    worldUnitsPerKm: positiveOr(raw.worldUnitsPerKm, DEFAULT_SETTINGS.worldUnitsPerKm),
  }
  const source = (parsed.presentation ?? {}) as Partial<PresentationSettings>
  const rawMapElements = Array.isArray(parsed.mapElements) ? parsed.mapElements as unknown[] : []
  const normalizedBasemapPaths = normalizeBasemapPaths((parsed as Record<string, unknown>).basemapPaths)
  const normalizedRoads = normalizeRoads((parsed as Record<string, unknown>).roads)
  const normalizedRoadStyles = normalizeRoadStyles((parsed as Record<string, unknown>).roadStyles)
  const normalizedLineLegend = normalizeLineLegend((parsed as Record<string, unknown>).lineLegend)
  const legacyLineBadges = rawMapElements.flatMap(value => normalizeLegacyLineBadge(value))
  const presentation: PresentationSettings = {
    ...DEFAULT_PRESENTATION_SETTINGS,
    ...source,
    startDate: normalizeRequiredDate(source.startDate || parsed.timeline?.startDate, today),
    endDate: normalizeRequiredDate(source.endDate || parsed.timeline?.endDate, today),
    eventDuration: finiteOr(source.eventDuration, DEFAULT_PRESENTATION_SETTINGS.eventDuration),
    growthSpeedKmPerSecond: positiveOr(source.growthSpeedKmPerSecond, DEFAULT_PRESENTATION_SETTINGS.growthSpeedKmPerSecond),
    stationOpeningDuration: positiveOr(source.stationOpeningDuration, DEFAULT_PRESENTATION_SETTINGS.stationOpeningDuration),
    pauseDuration: finiteOr(source.pauseDuration, DEFAULT_PRESENTATION_SETTINGS.pauseDuration),
    cameraViewWidth: positiveOr(source.cameraViewWidth, DEFAULT_PRESENTATION_SETTINGS.cameraViewWidth),
    overviewAfterEachPhase: source.overviewAfterEachPhase === true,
    overviewHoldDuration: nonNegativeOr(source.overviewHoldDuration, DEFAULT_PRESENTATION_SETTINGS.overviewHoldDuration),
    fps: source.fps === 60 ? 60 : 30,
    cameraMode: source.cameraMode === 'fixed' ? 'fixed' : 'follow',
    resolution: source.resolution === '1080x1920' || source.resolution === '1280x720' ? source.resolution : '1920x1080',
    showLabels: source.showLabels !== false,
    showForeignStationNames: source.showForeignStationNames !== false,
    showDate: source.showDate !== false,
    showOperatingLength: source.showOperatingLength !== false,
    showStationCount: source.showStationCount !== false,
    showBackground: source.showBackground !== false,
    showLegend: source.showLegend === true,
    title: typeof source.title === 'string' ? source.title : '',
  }
  const project: ActualRouteProject = {
    version: 1,
    name: typeof parsed.name === 'string' ? parsed.name : '恢复的实际走向工程',
    stations: parsed.stations.map(station => { const { styleOverrides: _ignored, ...rest }=station, styleOverrides=normalizeStationStyleOverrides(station.styleOverrides), nameHistory=normalizeStationNameHistory(station); const normalized=({ ...rest, ...(styleOverrides?{styleOverrides}:{}), ...(nameHistory?{nameHistory}:{}), ...(typeof station.nameS === 'string' && station.nameS.length ? {nameS:station.nameS} : {}), ...normalizedDateFields(station), labelOffsetX: Number.isFinite(station.labelOffsetX) ? station.labelOffsetX : 14, labelOffsetY: Number.isFinite(station.labelOffsetY) ? station.labelOffsetY : -14, ...(typeof station.labelRotation === 'number' && Number.isFinite(station.labelRotation) ? {labelRotation:station.labelRotation} : {}) }); if(nameHistory)syncStationNameFromHistory(normalized); return normalized }),
    lines: parsed.lines.map((line, index) => { const { styleOverrides: _ignored, ...rest }=line, styleOverrides=normalizeLineStyleOverrides(line.styleOverrides); return ({ ...rest, ...(styleOverrides?{styleOverrides}:{}), ...(typeof line.lineStyleId === 'string' && line.lineStyleId ? { lineStyleId: line.lineStyleId } : {}), ...normalizedDateFields(line), stationSequence: Array.isArray(line.stationSequence) ? line.stationSequence : [], ...(Array.isArray(line.lineBadges) ? {lineBadges:line.lineBadges.flatMap(value => normalizeLineBadge(value))} : {}), lineOrder: Number.isFinite(line.lineOrder) ? line.lineOrder : index, visible: line.visible !== false, locked: line.locked === true })}),
    stationLineRelations: Array.isArray(parsed.stationLineRelations) ? parsed.stationLineRelations.map(relation => ({ ...relation, ...normalizedDateFields(relation) })) : [],
    openingPhases: Array.isArray(parsed.openingPhases) ? parsed.openingPhases.map(phase => ({ id: String(phase.id), lineId: String(phase.lineId), name: typeof phase.name === 'string' ? phase.name : undefined, openedAt: normalizeRequiredDate(phase.openedAt, today), segmentIds: Array.isArray(phase.segmentIds) ? phase.segmentIds.map(String) : [], stationRelationIds: Array.isArray(phase.stationRelationIds) ? phase.stationRelationIds.map(String) : [], revealStartStationId: typeof phase.revealStartStationId === 'string' ? phase.revealStartStationId : undefined, revealEndStationId: typeof phase.revealEndStationId === 'string' ? phase.revealEndStationId : undefined, showOverviewAfter: phase.showOverviewAfter === true, overriddenSegmentIds: Array.isArray(phase.overriddenSegmentIds) ? phase.overriddenSegmentIds.map(String) : [], overriddenStationRelationIds: Array.isArray(phase.overriddenStationRelationIds) ? phase.overriddenStationRelationIds.map(String) : [] })) : [],
    geometry: { segments: parsed.geometry.segments.map(segment => ({ ...segment, ...normalizedDateFields(segment), ...(normalizeSegmentLineHistory(segment.lineHistory) ? { lineHistory: normalizeSegmentLineHistory(segment.lineHistory) } : {}), mode: segment.mode === 'smooth' || segment.mode === 'corner' || segment.mode === 'rounded' ? segment.mode : 'straight', ...(typeof segment.cornerRadius === 'number' && Number.isFinite(segment.cornerRadius) && segment.cornerRadius >= 0 ? {cornerRadius:segment.cornerRadius} : {}), structureType: segment.structureType === 'elevated' || segment.structureType === 'ground' ? segment.structureType : 'underground', structureNodes: Array.isArray(segment.structureNodes) ? segment.structureNodes.filter(node => node && typeof node.id === 'string').map(node => ({ id: node.id, structureAfter: node.structureAfter === 'elevated' || node.structureAfter === 'ground' ? node.structureAfter : 'underground', ...(typeof node.waypointId === 'string' ? { waypointId: node.waypointId } : {}), ...(typeof node.progress === 'number' && Number.isFinite(node.progress) ? { progress: Math.max(0, Math.min(1, node.progress)) } : {}) })) : [], waypoints: Array.isArray(segment.waypoints) ? segment.waypoints.map(waypoint => ({ ...waypoint, ...(typeof waypoint.cornerRadius === 'number' && Number.isFinite(waypoint.cornerRadius) && waypoint.cornerRadius >= 0 ? {cornerRadius:waypoint.cornerRadius} : {}) })) : [] })) },
    mapElements: rawMapElements.flatMap(element => normalizeMapElement(element)),
    ...(normalizedLineLegend ? { lineLegend: normalizedLineLegend } : {}),
    ...(normalizedBasemapPaths ? { basemapPaths: normalizedBasemapPaths } : {}),
    ...(normalizedRoads ? { roads: normalizedRoads } : {}),
    ...(normalizedRoadStyles ? { roadStyles: normalizedRoadStyles } : {}),
    background: parsed.background ?? null,
    timeline: { currentDate: normalizeRequiredDate(parsed.timeline?.currentDate, today), startDate: normalizeRequiredDate(parsed.timeline?.startDate, today), endDate: normalizeRequiredDate(parsed.timeline?.endDate, today), playing: false },
    presentation,
    settings,
    ...(normalizedStyles ? { styles: normalizedStyles } : {}),
  }
  for (const phase of project.openingPhases) {
    if (!phase.revealStartStationId) delete phase.revealStartStationId
    if (!phase.revealEndStationId) delete phase.revealEndStationId
    if (!phase.showOverviewAfter) delete phase.showOverviewAfter
  }
  for (const legacy of legacyLineBadges) {
    const line = project.lines.find(item => item.id === legacy.lineId)
    if (!line || line.lineBadges?.some(item => item.id === legacy.badge.id)) continue
    line.lineBadges ??= []
    line.lineBadges.push(legacy.badge)
  }
  migrateLegacyStationDates(project)
  return project
}

function migrateLegacyStationDates(project: ActualRouteProject) {
  for (const station of project.stations) {
    if (!station.openedAt) continue
    const relations = project.stationLineRelations.filter(relation => relation.stationId === station.id)
    if (relations.length !== 1) continue
    const relation = relations[0]
    const lineDate = project.lines.find(line => line.id === relation.lineId)?.openedAt
    if ((!relation.openedAt || relation.openedAt === lineDate) && (!relation.openedAt || relation.openedAt < station.openedAt)) relation.openedAt = station.openedAt
  }
}

const normalizedDateFields = (item: { openedAt?: unknown; closedAt?: unknown }) => ({
  ...('openedAt' in item ? { openedAt: normalizeISODate(item.openedAt) } : {}),
  ...('closedAt' in item ? { closedAt: normalizeISODate(item.closedAt) } : {}),
})
const positiveOr = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
const nonNegativeOr = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
const approximately = (value: unknown, target: number) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value-target)<1e-9
const isLabelDirection = (value: unknown): value is LabelDirection => typeof value === 'string' && ['up','down','left','right','upper-left','upper-right','lower-left','lower-right'].includes(value)
const finiteOr = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const restoredTransferSetting = (value: unknown, withdrawnDefault: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value - withdrawnDefault) > 1e-9 ? value : fallback
function normalizeLineStyleOverrides(value: unknown): LineStyleOverrides|undefined {
  if(!value||typeof value!=='object')return undefined
  const raw=value as Record<string,unknown>, result:LineStyleOverrides={}
  if(typeof raw.lineWidth==='number'&&Number.isFinite(raw.lineWidth)&&raw.lineWidth>0)result.lineWidth=raw.lineWidth
  return Object.keys(result).length?result:undefined
}
function normalizeStationStyleOverrides(value: unknown): StationStyleOverrides|undefined {
  if(!value||typeof value!=='object')return undefined
  const raw=value as Record<string,unknown>, result:StationStyleOverrides={}
  for(const key of ['stationSize','transferMinorAxis','labelSize','foreignLabelSize'] as const)if(typeof raw[key]==='number'&&Number.isFinite(raw[key])&&raw[key]>0)result[key]=raw[key]
  for(const key of ['transferEndPadding','transferDotGap','foreignLabelGap'] as const)if(typeof raw[key]==='number'&&Number.isFinite(raw[key])&&raw[key]>=0)result[key]=raw[key]
  for(const key of ['labelFontFamily','foreignLabelFontFamily'] as const){const normalized=normalizeFontFamily(raw[key]);if(normalized)result[key]=normalized}
  for(const key of ['labelFontWeight','foreignLabelFontWeight'] as const){const normalized=normalizeFontWeight(raw[key]);if(normalized!==null)result[key]=normalized}
  for(const key of ['labelColor','foreignLabelColor'] as const){const normalized=normalizeHexColor(raw[key]);if(normalized)result[key]=normalized}
  return Object.keys(result).length?result:undefined
}
function legacyTypographyFallback(stations: ActualRouteProject['stations'] | undefined) {
  const sourceWeight=stations?.find(station=>station.source?.labelAnchorMode==='aarc-block')?.source?.stationNameFontWeight
  if(sourceWeight===undefined)return DEFAULT_SETTINGS
  const weight=sourceWeight==='bold'?700:sourceWeight==='normal'?400:normalizeFontWeight(sourceWeight)??400
  return {...DEFAULT_SETTINGS,stationLabelFontFamily:'sans-serif',stationLabelFontWeight:weight,stationForeignLabelFontFamily:'sans-serif',stationForeignLabelFontWeight:weight,stationForeignLabelColor:'#999999'}
}
function normalizeMapElement(value: unknown): MapElement[] {
  if (!value || typeof value !== 'object') return []
  const item = value as Record<string, unknown>, id = typeof item.id === 'string' ? item.id : ''
  const x = finiteOr(item.x, 0), y = finiteOr(item.y, 0), rotation = finiteOr(item.rotation, 0), visible = item.visible !== false
  if (!id) return []
  if (item.type === 'text' && typeof item.text === 'string') return [{ id, type: 'text', x, y, text: item.text, fontSize: positiveOr(item.fontSize, 24), fontWeight: item.fontWeight === 'bold' ? 'bold' : 'normal', textAlign: item.textAlign === 'start' || item.textAlign === 'end' ? item.textAlign : 'middle', rotation, visible }]
  return []
}
function normalizeLineBadge(value: unknown): LineBadge[] {
  if (!value || typeof value !== 'object') return []
  const item=value as Record<string,unknown>,id=typeof item.id==='string'?item.id:''
  if(!id)return []
  return [{id,x:finiteOr(item.x,0),y:finiteOr(item.y,0),size:positiveOr(item.size,36),rotation:finiteOr(item.rotation,0),visible:item.visible!==false}]
}
function normalizeLegacyLineBadge(value: unknown): {lineId:string;badge:LineBadge}[] {
  if (!value || typeof value !== 'object') return []
  const item=value as Record<string,unknown>
  if(item.type!=='lineBadge'||typeof item.lineId!=='string')return []
  const badge=normalizeLineBadge(item)[0]
  return badge?[{lineId:item.lineId,badge}]:[]
}
export const serializeProject = (project: ActualRouteProject) => JSON.stringify(project, null, 2)
export function downloadText(filename: string, text: string, type: string) { const url = URL.createObjectURL(new Blob([text], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url) }
