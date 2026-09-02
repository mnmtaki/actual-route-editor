import type { ActualRouteProject, Line, LineStyle, LineStyleLayer, Segment } from './model'
import { effectiveLineWidth } from './style'

export const BUILTIN_NORMAL_STYLE_ID = 'normal'
export const BUILTIN_ELEVATED_STYLE_ID = 'elevated'

export const BUILTIN_LINE_STYLES: readonly LineStyle[] = [
  { id: BUILTIN_NORMAL_STYLE_ID, name: '普通', builtin: true, layers: [{ id: 'normal-main', colorMode: 'followLine', width: 1, widthMode: 'ratio', opacity: 1, lineCap: 'round', lineJoin: 'round' }] },
  { id: BUILTIN_ELEVATED_STYLE_ID, name: '高架', builtin: true, hideBaseLine: true, layers: [
    { id: 'elevated-outer', colorMode: 'followLine', colorMixTarget: '#283033', colorMixAmount: .55, width: 1.38, widthMode: 'ratio', opacity: 1, lineCap: 'butt', lineJoin: 'round' },
    { id: 'elevated-separator', colorMode: 'followLine', colorMixTarget: '#f7f4ec', colorMixAmount: .82, width: 1.18, widthMode: 'ratio', opacity: 1, lineCap: 'butt', lineJoin: 'round' },
    { id: 'elevated-main', colorMode: 'followLine', width: 1, widthMode: 'ratio', opacity: 1, lineCap: 'butt', lineJoin: 'round' },
  ] },
]

const clone = <T,>(value: T): T => structuredClone(value)

export function getLineStyles(project: ActualRouteProject): LineStyle[] {
  const saved = project.styles ?? []
  const result = BUILTIN_LINE_STYLES.map(style => clone(saved.find(item => item.id === style.id) ?? style))
  for (const style of saved) if (!result.some(item => item.id === style.id) && style.id !== BUILTIN_NORMAL_STYLE_ID && style.id !== BUILTIN_ELEVATED_STYLE_ID) result.push(clone(style))
  return result.map(style => ({ ...style, builtin: BUILTIN_LINE_STYLES.some(item => item.id === style.id) }))
}

export function getLineStyle(project: ActualRouteProject, styleId: string | undefined): LineStyle {
  const styles = getLineStyles(project)
  return styles.find(style => style.id === (styleId ?? BUILTIN_NORMAL_STYLE_ID)) ?? styles[0]
}

/** Segment.structureType remains the source of truth for existing elevated pieces. */
export function resolveLineStyle(project: ActualRouteProject, line: Line, segment?: Segment): LineStyle {
  return segment?.structureType === 'elevated' ? getLineStyle(project, BUILTIN_ELEVATED_STYLE_ID) : getLineStyle(project, line.lineStyleId)
}

export interface ResolvedLineStyleLayer extends LineStyleLayer { resolvedColor: string; resolvedWidth: number; resolvedOpacity: number; resolvedDash?: string }
export function resolveLineStyleLayers(style: LineStyle, lineColor: string, lineWidth: number): ResolvedLineStyleLayer[] {
  return style.layers.map(layer => {
    const widthMode = layer.widthMode ?? 'ratio'
    const resolvedWidth = widthMode === 'absolute' ? Math.max(0, layer.width) : Math.max(0, lineWidth * layer.width)
    const baseColor = layer.colorMode === 'custom' ? (layer.color ?? lineColor) : lineColor
    const resolvedColor = layer.colorMixTarget && Number.isFinite(layer.colorMixAmount) ? mixHex(baseColor, layer.colorMixTarget, Math.max(0, Math.min(1, layer.colorMixAmount!))) : baseColor
    const dash = layer.dash?.filter(value => Number.isFinite(value) && value >= 0)
    return { ...layer, resolvedColor, resolvedWidth, resolvedOpacity: Math.max(0, Math.min(1, layer.opacity ?? 1)), ...(dash?.length ? { resolvedDash: dash.join(' ') } : {}) }
  })
}

export function ensureProjectLineStyles(project: ActualRouteProject): LineStyle[] {
  return getLineStyles(project).map(style => ({ ...style, layers: style.layers.map(layer => ({ ...layer, ...(layer.dash ? { dash: [...layer.dash] } : {}) })) }))
}

function normalizeLayer(value: unknown, index: number): LineStyleLayer | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>, width = Number(raw.width)
  if (!Number.isFinite(width) || width < 0) return null
  const colorMode: LineStyleLayer['colorMode'] = raw.colorMode === 'custom' ? 'custom' : 'followLine'
  const dash = Array.isArray(raw.dash) ? raw.dash.map(Number).filter(item => Number.isFinite(item) && item >= 0) : undefined
  const lineCap = raw.lineCap === 'butt' || raw.lineCap === 'square' ? raw.lineCap : 'round'
  const lineJoin = raw.lineJoin === 'miter' || raw.lineJoin === 'bevel' ? raw.lineJoin : 'round'
  const opacity = Number(raw.opacity)
  const colorMixAmount = Number(raw.colorMixAmount)
  return { id: typeof raw.id === 'string' && raw.id ? raw.id : 'layer-' + (index + 1), colorMode, ...(typeof raw.color === 'string' ? { color: raw.color } : {}), ...(typeof raw.colorMixTarget === 'string' && Number.isFinite(colorMixAmount) ? { colorMixTarget: raw.colorMixTarget, colorMixAmount: Math.max(0, Math.min(1, colorMixAmount)) } : {}), width, widthMode: raw.widthMode === 'absolute' ? 'absolute' : 'ratio', ...(Number.isFinite(opacity) ? { opacity: Math.max(0, Math.min(1, opacity)) } : {}), ...(dash?.length ? { dash } : {}), lineCap, lineJoin }
}

export function normalizeLineStyles(value: unknown): LineStyle[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: LineStyle[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>, id = typeof raw.id === 'string' ? raw.id : ''
    if (!id) continue
    const layers = Array.isArray(raw.layers) ? raw.layers.map(normalizeLayer).filter((layer): layer is LineStyleLayer => Boolean(layer)) : []
    result.push({ id, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id, ...(raw.hideBaseLine === true ? { hideBaseLine: true } : {}), layers, ...(BUILTIN_LINE_STYLES.some(style => style.id === id) ? { builtin: true } : {}) })
  }
  return result.length ? result : undefined
}

export function materializeLineStyle(project: ActualRouteProject, style: LineStyle): ActualRouteProject {
  const next = structuredClone(project)
  next.styles = ensureProjectLineStyles(next).map(item => item.id === style.id ? clone(style) : item)
  return next
}

export function lineBaseWidth(project: ActualRouteProject, line: Line) { return effectiveLineWidth(line, project.settings) }

function mixHex(source: string, target: string, amount: number) {
  const a = parseHex(source) ?? parseHex('#555555')!, b = parseHex(target) ?? parseHex('#555555')!
  const channel = (from: number, to: number) => Math.round(from + (to - from) * amount).toString(16).padStart(2, '0')
  return '#' + channel(a[0], b[0]) + channel(a[1], b[1]) + channel(a[2], b[2])
}
function parseHex(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  return match ? [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16)] : null
}
