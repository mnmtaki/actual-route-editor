import type { AarcDataSource, AarcLineStyle, AarcLineStyleLayer, AarcPattern, AarcSelectionGroup, AarcTextOptions, AarcTextTagIcon } from '../data/model'

export interface AarcNormalizedConfig extends Record<string, unknown> {
  lineWidth: number
  lineCarpetWiden: number
  lineTurnAreaRadius: number
  lineWidthMapped: Record<string, Record<string, unknown>>
  snapOctaClingPtPtDist: number
  snapOctaClingPtPtThrs: number
  freePtClusterMode: 'off' | 'strict' | 'loose'
}
export interface AarcNormalizedSave extends Record<string, unknown> {
  idIncre: number
  lines: Array<Record<string, unknown>>
  points: Array<Record<string, unknown>>
  pointLinks: Array<Record<string, unknown>>
  cvsSize: [number, number]
  textTags: Array<Record<string, unknown>>
  lineStyles: AarcLineStyle[]
  patterns: AarcPattern[]
  textTagIcons: AarcTextTagIcon[]
  dataSources: AarcDataSource[]
  selectionGroups: AarcSelectionGroup[]
  lineGroups: Array<Record<string, unknown>>
  timeSlices: Array<Record<string, unknown>>
  styleSlices: Array<Record<string, unknown>>
  meta: Record<string, unknown>
  config: AarcNormalizedConfig
}

const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined)
const positive = (value: unknown): number | undefined => { const n = finite(value); return n !== undefined && n > 0 ? n : undefined }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const clone = <T>(value: T): T => structuredClone(value)
function normalizeSlice(value: unknown): Record<string, unknown> {
  const raw = object(value), result = clone(raw)
  for (const key of ['id', 'line', 'fromPt', 'toPt', 'style'] as const) {
    const n = finite(raw[key])
    if (n !== undefined) result[key] = n
  }
  const time = object(raw.time)
  if (Object.keys(time).length) result.time = clone(time)
  return result
}

export const DEFAULT_AARC_CONFIG: AarcNormalizedConfig = {
  lineWidth: 14,
  lineCarpetWiden: 7,
  lineTurnAreaRadius: 30,
  lineWidthMapped: {},
  snapOctaClingPtPtDist: 25,
  snapOctaClingPtPtThrs: 10,
  freePtClusterMode: 'loose',
}

function normalizeConfig(value: unknown): AarcNormalizedConfig {
  const raw = object(value)
  const mappedRaw = object(raw.lineWidthMapped)
  const lineWidthMapped: Record<string, Record<string, unknown>> = {}
  for (const [key, item] of Object.entries(mappedRaw)) if (item && typeof item === 'object' && !Array.isArray(item)) lineWidthMapped[key] = { ...object(item) }
  const mode = raw.freePtClusterMode === 'off' || raw.freePtClusterMode === 'strict' ? raw.freePtClusterMode : 'loose'
  return {
    ...DEFAULT_AARC_CONFIG,
    ...raw,
    lineWidth: positive(raw.lineWidth) ?? DEFAULT_AARC_CONFIG.lineWidth,
    lineCarpetWiden: finite(raw.lineCarpetWiden) ?? DEFAULT_AARC_CONFIG.lineCarpetWiden,
    lineTurnAreaRadius: positive(raw.lineTurnAreaRadius) ?? DEFAULT_AARC_CONFIG.lineTurnAreaRadius,
    snapOctaClingPtPtDist: positive(raw.snapOctaClingPtPtDist) ?? DEFAULT_AARC_CONFIG.snapOctaClingPtPtDist,
    snapOctaClingPtPtThrs: finite(raw.snapOctaClingPtPtThrs) ?? DEFAULT_AARC_CONFIG.snapOctaClingPtPtThrs,
    freePtClusterMode: mode,
    lineWidthMapped,
  }
}

function normalizeStyle(value: unknown): AarcLineStyle {
  const raw = object(value), layers = array(raw.layers).map(item => {
    const layer = object(item), result: AarcLineStyleLayer = {}
    if (typeof layer.color === 'string') result.color = layer.color
    if (layer.colorMode === 'line' || layer.colorMode === 'fixed') result.colorMode = layer.colorMode
    if (finite(layer.width) !== undefined) result.width = finite(layer.width)
    if (finite(layer.opacity) !== undefined) result.opacity = finite(layer.opacity)
    if (typeof layer.dash === 'string') result.dash = layer.dash
    if (typeof layer.cap === 'string') result.cap = layer.cap
    if (typeof layer.join === 'string') result.join = layer.join
    if (finite(layer.pattern) !== undefined) result.patternId = String(finite(layer.pattern))
    return result
  })
  return { id: String(raw.id ?? ''), ...(typeof raw.name === 'string' ? { name: raw.name } : {}), noBase: raw.noBase === true, layers, source: { format: 'aarc', kind: 'line-style', sourceStyleId: finite(raw.id), raw: clone(raw) }, raw: clone(raw) }
}
function normalizeIcon(value: unknown): AarcTextTagIcon {
  const raw = object(value), id = String(raw.id ?? '')
  return { id, ...(typeof raw.name === 'string' ? { name: raw.name } : {}), ...(typeof raw.url === 'string' ? { url: raw.url } : {}), ...(finite(raw.width) !== undefined ? { width: finite(raw.width) } : {}), source: { format: 'aarc', kind: 'icon', raw: clone(raw) }, raw: clone(raw) }
}
function normalizePattern(value: unknown): AarcPattern {
  const raw = object(value)
  return { id: String(raw.id ?? ''), ...(typeof raw.name === 'string' ? { name: raw.name } : {}), ...(finite(raw.width) !== undefined ? { width: finite(raw.width) } : {}), ...(finite(raw.height) !== undefined ? { height: finite(raw.height) } : {}), ...(object(raw.grid).constructor === Object && Object.keys(object(raw.grid)).length ? { grid: clone(object(raw.grid)) } : {}), source: { format: 'aarc', kind: 'pattern', raw: clone(raw) }, raw: clone(raw) }
}
function normalizeDataSource(value: unknown): AarcDataSource {
  const raw = object(value)
  return { id: String(raw.id ?? ''), ...(typeof raw.name === 'string' ? { name: raw.name } : {}), ...(typeof raw.url === 'string' ? { url: raw.url } : {}), ...(typeof raw.type === 'string' ? { type: raw.type } : {}), ...(typeof raw.autoUpdate === 'boolean' ? { autoUpdate: raw.autoUpdate } : {}), ...(typeof raw.overwriteSameName === 'boolean' ? { overwriteSameName: raw.overwriteSameName } : {}), source: { format: 'aarc', raw: clone(raw) }, raw: clone(raw) }
}
function normalizeSelectionGroup(value: unknown): AarcSelectionGroup {
  const raw = object(value)
  return { id: String(raw.id ?? ''), ...(typeof raw.name === 'string' ? { name: raw.name } : {}), pointIds: array(raw.ptIds).map(finite).filter((n): n is number => n !== undefined), textTagIds: array(raw.tagIds).map(finite).filter((n): n is number => n !== undefined), source: { format: 'aarc', raw: clone(raw) }, raw: clone(raw) }
}

export function normalizeAarcSave(raw: unknown): AarcNormalizedSave {
  const input = object(raw)
  const meta = clone(object(input.meta))
  const initialIdIncre = positive(input.idIncre) ?? 1
  const iconVersion = finite(meta.textTagIconsVersion) ?? 0
  const hasDataSources = Object.prototype.hasOwnProperty.call(input, 'dataSources') && (Array.isArray(input.dataSources) || Boolean(input.dataSources && typeof input.dataSources === 'object'))
  const sourceDataSources = hasDataSources
    ? (Array.isArray(input.dataSources) ? input.dataSources : [input.dataSources]).map(normalizeDataSource)
    : [normalizeDataSource({ id: initialIdIncre, name: '滨蜀颜色库', url: 'http://binshu.jowei19.com/colorsetsapi.json', type: 'colorSets', autoUpdate: true, overwriteSameName: true })]
  const suppliedIcons = array(input.textTagIcons).map(normalizeIcon)
  const textTagIcons = [...suppliedIcons]
  let idIncre = initialIdIncre + (hasDataSources ? 0 : 1)
  if (iconVersion < 1) {
    textTagIcons.push(
      normalizeIcon({ id: idIncre++, width: 50, name: 'a-机场', url: '/icons/a/airport.svg' }),
      normalizeIcon({ id: idIncre++, width: 50, name: 'a-火车', url: '/icons/a/train.svg' }),
    )
    meta.textTagIconsVersion = 1
  }
  const normalized = {
    ...clone(input),
    idIncre,
    meta,
    lines: array(input.lines).filter(item => item && typeof item === 'object').map(item => ({ ...object(item), pts: array(object(item).pts).map(finite).filter((n): n is number => n !== undefined) })),
    points: array(input.points).filter(item => item && typeof item === 'object').map(item => ({ ...object(item), pos: Array.isArray(object(item).pos) ? [finite((object(item).pos as unknown[])[0]), finite((object(item).pos as unknown[])[1])] : undefined })),
    pointLinks: array(input.pointLinks).filter(item => item && typeof item === 'object').map(item => ({ ...object(item), pts: array(object(item).pts).map(finite).filter((n): n is number => n !== undefined) })),
    cvsSize: (() => { const p = array(input.cvsSize); return [positive(p[0]) ?? 1000, positive(p[1]) ?? 1000] as [number, number] })(),
    textTags: array(input.textTags).filter(item => item && typeof item === 'object').map(item => clone(object(item))),
    lineStyles: array(input.lineStyles).map(normalizeStyle),
    patterns: array(input.patterns).map(normalizePattern),
    textTagIcons,
    dataSources: sourceDataSources,
    selectionGroups: array(input.selectionGroups).map(normalizeSelectionGroup),
    lineGroups: array(input.lineGroups).filter(item => item && typeof item === 'object').map(item => clone(object(item))),
    timeSlices: array(input.timeSlices).filter(item => item && typeof item === 'object').map(normalizeSlice),
    styleSlices: array(input.styleSlices).filter(item => item && typeof item === 'object').map(normalizeSlice),
    config: normalizeConfig(input.config),
  }
  return normalized as AarcNormalizedSave
}

export interface AarcLineMetrics { widthRatio: number; bodyWidth: number; ptSize: number; ptNameSize: number; ptSnapSize: number; ptNameSnapSize: number }
const mappedFor = (config: AarcNormalizedConfig, ratio: number) => config.lineWidthMapped[String(ratio)] ?? config.lineWidthMapped[String(Number(ratio))]
const mappedValue = (mapped: Record<string, unknown> | undefined, key: string): number | undefined => mapped && positive(mapped[key]) !== undefined ? positive(mapped[key]) : undefined

/** Upstream saveStore precedence, including its intentional `||` fallback for ptSize/ptNameSize. */
export function resolveAarcLineMetrics(line: Record<string, unknown>, config: AarcNormalizedConfig | Record<string, unknown>): AarcLineMetrics {
  const cfg = normalizeConfig(config), ratio = positive(line.width) ?? 1, mapped = mappedFor(cfg, ratio)
  const mappedSize = mappedValue(mapped, 'staSize'), mappedName = mappedValue(mapped, 'staNameSize')
  const mappedSnap = mapped && Object.prototype.hasOwnProperty.call(mapped, 'staSnapSize') ? finite(mapped.staSnapSize) : undefined
  const mappedNameSnap = mapped && Object.prototype.hasOwnProperty.call(mapped, 'staNameSnapSize') ? finite(mapped.staNameSnapSize) : undefined
  const ptSize = (positive(line.ptSize) ?? mappedSize ?? ratio) || 1
  const ptNameSize = (positive(line.ptNameSize) ?? mappedName ?? ratio) || 1
  const ptSnapFallback = positive(line.ptSize) ?? mappedSize ?? ratio
  const ptNameSnapFallback = positive(line.ptSize) ?? mappedSize ?? ratio
  // Upstream keeps an explicitly present mapped sta*SnapSize, including 0;
  // only a missing value falls through to the normal size/width fallback.
  const ptSnapSize = positive(line.ptSnapSize) ?? (mappedSnap !== undefined ? mappedSnap : ptSnapFallback)
  const ptNameSnapSize = positive(line.ptNameSnapSize) ?? (mappedNameSnap !== undefined ? mappedNameSnap : ptNameSnapFallback)
  return { widthRatio: ratio, bodyWidth: cfg.lineWidth * ratio, ptSize, ptNameSize, ptSnapSize, ptNameSnapSize }
}

export function aggregateAarcPointMetrics(pointId: number, lines: Array<Record<string, unknown>>, memberships: Map<number, number[]>, config: AarcNormalizedConfig | Record<string, unknown>) {
  const ids = memberships.get(pointId) ?? [], byId = new Map(lines.map(line => [finite(line.id), line]))
  const metrics = ids.map(id => byId.get(id)).filter((line): line is Record<string, unknown> => Boolean(line)).map(line => resolveAarcLineMetrics(line, config))
  return { ptSize: metrics.length ? Math.max(...metrics.map(item => item.ptSize)) : 1, ptNameSize: metrics.length ? Math.max(...metrics.map(item => item.ptNameSize)) : 1, ptSnapSize: metrics.length ? Math.max(...metrics.map(item => item.ptSnapSize)) : 1, ptNameSnapSize: metrics.length ? Math.max(...metrics.map(item => item.ptNameSnapSize)) : 1 }
}

export function readAarcTextOptions(value: unknown): AarcTextOptions | undefined {
  const raw = object(value), result: AarcTextOptions = {}
  if (finite(raw.size) !== undefined) result.size = finite(raw.size)
  if (typeof raw.color === 'string') result.color = raw.color
  if (typeof raw.font === 'string') result.font = raw.font
  if (typeof raw.weight === 'string') result.weight = raw.weight
  if (typeof raw.style === 'string') result.style = raw.style
  return Object.keys(result).length ? result : undefined
}
