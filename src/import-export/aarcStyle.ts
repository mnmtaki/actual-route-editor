import type { AarcLineStyle, AarcLineStyleLayer } from '../data/model'

export interface ResolvedAarcStyleLayer extends AarcLineStyleLayer {
  sourceStyleId: string
  inherited: boolean
}

/**
 * Resolve AARC style registry entries without baking them into ActualRoute's
 * theme.  A style id of -1 is the upstream "inherit parent style" sentinel;
 * callers pass the parent style id explicitly so resolution stays pure.
 */
export function resolveAarcStyle(
  styleId: string | number | null | undefined,
  styles: AarcLineStyle[] | undefined,
  parentStyleId?: string | number | null,
): AarcLineStyle | undefined {
  const registry = styles ?? []
  const numeric = styleId === null || styleId === undefined ? undefined : Number(styleId)
  const effectiveId = numeric === -1 || styleId === '-1' ? parentStyleId : styleId
  if (effectiveId === null || effectiveId === undefined) return undefined
  const id = String(effectiveId)
  const found = registry.find(style => String(style.id) === id)
  return found ? structuredClone(found) : undefined
}

export function resolveAarcStyleLayers(
  styleId: string | number | null | undefined,
  styles: AarcLineStyle[] | undefined,
  parentStyleId?: string | number | null,
): ResolvedAarcStyleLayer[] {
  const style = resolveAarcStyle(styleId, styles, parentStyleId)
  if (!style) return []
  // AARC's layer array is authored in reverse paint order.  Keep the
  // resolved presentation order deterministic while leaving the source
  // registry untouched.
  return style.layers.slice().reverse().map(layer => ({ ...structuredClone(layer), sourceStyleId: style.id, inherited: styleId === -1 || styleId === '-1' }))
}

/** AARC layer widths/dashes are multipliers of the line body width. */
export function resolveAarcLayerGeometry(layer: AarcLineStyleLayer, bodyWidth: number) {
  const base = Number.isFinite(bodyWidth) && bodyWidth > 0 ? bodyWidth : 1
  const multiplier = Number.isFinite(layer.width) && (layer.width as number) >= 0 ? layer.width as number : 1
  const dash = typeof layer.dash === 'string'
    ? layer.dash.trim().split(/[ ,]+/).filter(Boolean).map(value => Number(value)).filter(value => Number.isFinite(value)).map(value => value * base)
    : undefined
  return { width: multiplier * base, dash, color: layer.color, colorMode: layer.colorMode ?? 'fixed', opacity: layer.opacity, cap: layer.cap, join: layer.join, patternId: layer.patternId }
}

export function chooseAarcStyleId(rawStyle: unknown): string | undefined {
  const n = typeof rawStyle === 'number' ? rawStyle : Number(rawStyle)
  return Number.isFinite(n) ? String(n) : undefined
}

/** Map an AARC style-slice reference into the shared Segment style override.
 *  The three sentinel meanings are intentionally distinct: 0 is an explicit
 *  no-style/base-line-only override, -1 inherits the already resolved Line
 *  style, and positive ids select a concrete imported style.
 */
export function resolveAarcSegmentStyleId(styleId: number | null | undefined): string | null | undefined {
  if (styleId === undefined || styleId === null || styleId === -1) return undefined
  if (styleId === 0) return null
  return String(styleId)
}

import type { LineStyle, LineStyleLayer } from '../data/model'

function mapLineCap(value: string | undefined): LineStyleLayer['lineCap'] {
  return value === 'butt' || value === 'square' ? value : 'round'
}
function mapLineJoin(value: string | undefined): LineStyleLayer['lineJoin'] {
  return value === 'miter' || value === 'bevel' ? value : 'round'
}
function parseAarcDash(value: string | undefined): number[] | undefined {
  if (typeof value !== 'string') return undefined
  const dash = value.trim().split(/[ ,]+/).map(Number).filter(item => Number.isFinite(item) && item >= 0)
  return dash.length ? dash : undefined
}

/** Convert the source style registry into the shared ActualRoute style model.
 * Width and dash values remain ratios so they follow each line's calibrated
 * body width at render time.  The original registry is still retained in
 * project.aarc for lossless provenance.
 */
export function convertAarcLineStyles(styles: AarcLineStyle[] | undefined): LineStyle[] {
  return (styles ?? []).flatMap(style => {
    const id = String(style.id || '').trim()
    if (!id) return []
    // The shared renderer paints layers in array order; AARC paints its
    // registry layers in reverse order, so convert a derived reversed array.
    const layers = style.layers.slice().reverse().flatMap((layer, index) => {
      const width = Number(layer.width)
      if (!Number.isFinite(width) || width < 0) return []
      const dash = parseAarcDash(layer.dash)
      const converted: LineStyleLayer = {
        id: `aarc-${id}-${index + 1}`,
        // Upstream AARC treats an omitted colorMode as the fixed/default
        // layer color.  Only an explicit "line" value follows the line.
        colorMode: layer.colorMode === 'line' ? 'followLine' : 'custom',
        ...(layer.color ? { color: layer.color } : {}),
        width,
        widthMode: 'ratio',
        ...(Number.isFinite(layer.opacity) ? { opacity: Math.max(0, Math.min(1, layer.opacity!)) } : {}),
        ...(dash ? { dash, dashMode: 'ratio' as const } : {}),
        ...(layer.patternId ? { sourcePatternId: String(layer.patternId) } : {}),
        lineCap: mapLineCap(layer.cap),
        lineJoin: mapLineJoin(layer.join),
      }
      return [converted]
    })
    return [{ id, name: style.name?.trim() || `AARC 样式 ${id}`, hideBaseLine: style.noBase === true, layers, source: style.source }]
  })
}
