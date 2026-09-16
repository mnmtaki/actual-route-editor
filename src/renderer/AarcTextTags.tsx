import { memo, useEffect, useState } from 'react'
import type { AarcTextTag, AarcTextTagIcon, ActualRouteProject, Line } from '../data/model'
import { getEffectiveLineColor } from '../data/lineIdentity'

function textLines(value: string) { return value.split(/\r?\n/) }
const CLASSIC_DROP_CAP = /^[0-9a-zA-Z]{1,3}(?=\s?号?环?线$)/
const LOOSE_DROP_CAP = /^[0-9a-zA-Z]{1,10}(?=.*号?环?线$)/

type TagMode = 'plain' | 'line' | 'terrain'
type LayerMode = 'sunken' | 'notSunken'
type Sgn = -1 | 0 | 1
interface SourceTarget {
  mode: Exclude<TagMode, 'plain'>
  sourceId?: number
  line?: Line
  name: string
  nameSub: string
  color: string
  tagTextColor?: string
}
interface TagParams { anchorX: Sgn; anchorY: Sgn; textAlign: Sgn; width: number }

const finite = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const sourceConfig = (project: ActualRouteProject) => record(project.aarc?.config ?? record(project.aarc?.raw).config)
const nestedConfig = (project: ActualRouteProject, key: 'textTagPlain' | 'textTagForLine' | 'textTagForTerrain') => record(sourceConfig(project)[key])
const configString = (project: ActualRouteProject, key: string, fallback: string) => typeof sourceConfig(project)[key] === 'string' ? sourceConfig(project)[key] as string : fallback
const configNumber = (project: ActualRouteProject, key: string, fallback: number) => finite(sourceConfig(project)[key]) ?? fallback
const clampRatio = (value: unknown, fallback: number) => {
  const n = finite(value)
  if (n === undefined) return fallback
  return Math.max(0, Math.min(16, n)) || fallback
}
const sgn = (value: unknown, fallback: Sgn = 0): Sgn => value === -1 || value === 0 || value === 1 ? value : fallback

export function resolveAarcDropCap(tag: AarcTextTag, primary: string, secondary: string): string | undefined {
  if (!tag.dropCap || !secondary) return undefined
  if (typeof tag.dropCapLength === 'number' && tag.dropCapLength > 0 && tag.dropCapLength <= primary.length) return primary.slice(0, tag.dropCapLength)
  const mode = tag.raw?.dropCapDetect === 'loose' ? LOOSE_DROP_CAP : CLASSIC_DROP_CAP
  const match = mode.exec(primary)
  return match?.[0] || undefined
}

function sourceLine(project: ActualRouteProject, sourceId: number | undefined): Record<string, unknown> | undefined {
  if (sourceId === undefined) return undefined
  const raw = record(project.aarc?.raw).lines
  if (!Array.isArray(raw)) return undefined
  return raw.find(item => finite(record(item).id) === sourceId) as Record<string, unknown> | undefined
}
function nativeLineForSource(project: ActualRouteProject, sourceId: number | undefined) {
  if (sourceId === undefined) return undefined
  return project.lines.find(line => finite(line.source?.sourceLineId ?? line.source?.lineId) === sourceId)
}
function sourceTarget(project: ActualRouteProject, tag: AarcTextTag): SourceTarget | undefined {
  const explicitSourceId = finite(tag.source?.forId)
  const native = tag.lineId ? project.lines.find(line => line.id === tag.lineId) : nativeLineForSource(project, explicitSourceId)
  const sourceId = explicitSourceId ?? finite(native?.source?.sourceLineId ?? native?.source?.lineId)
  const raw = sourceLine(project, sourceId)
  if (!native && !raw) return undefined
  const terrain = finite(raw?.type) === 1 || tag.kind === 'TerrainNameLabel' || tag.source?.targetKind === 'terrain'
  if (terrain) {
    const path = project.basemapPaths?.find(item => finite(item.source?.sourceLineId ?? item.source?.lineId) === sourceId)
    return {
      mode: 'terrain',
      sourceId,
      name: typeof raw?.name === 'string' && raw.name ? raw.name : path?.name ?? '未命名地形',
      nameSub: typeof raw?.nameSub === 'string' ? raw.nameSub : '',
      color: path?.color ?? (typeof raw?.color === 'string' && raw.color ? raw.color : '#64748b'),
    }
  }
  return {
    mode: 'line',
    sourceId,
    line: native,
    name: native?.name ?? (typeof raw?.name === 'string' && raw.name ? raw.name : '未命名线路'),
    nameSub: native?.nameSub ?? (typeof raw?.nameSub === 'string' ? raw.nameSub : ''),
    color: native ? getEffectiveLineColor(project, native) : (typeof raw?.color === 'string' && raw.color ? raw.color : '#64748b'),
    ...(typeof raw?.tagTextColor === 'string' && raw.tagTextColor ? { tagTextColor: raw.tagTextColor } : {}),
  }
}

export function resolveAarcTextTagContent(tag: AarcTextTag, project: ActualRouteProject, secondary = false) {
  const target = sourceTarget(project, tag)
  const override = secondary ? tag.textSOverride : tag.textOverride
  if (target) {
    if (secondary) {
      if (override?.trim()) return override.trim()
      const explicitMain = (tag.textOverride ?? tag.text ?? '').trim()
      return explicitMain ? '' : target.nameSub
    }
    return override?.trim() || target.name
  }
  if (override !== undefined) return override
  return secondary ? tag.textS ?? '' : tag.text ?? ''
}

function paramsFor(tag: AarcTextTag, project: ActualRouteProject, mode: TagMode): TagParams {
  const cfg = nestedConfig(project, mode === 'line' ? 'textTagForLine' : mode === 'terrain' ? 'textTagForTerrain' : 'textTagPlain')
  const anchorX = sgn(tag.anchorX, sgn(cfg.anchorX))
  const anchorY = sgn(tag.anchorY, sgn(cfg.anchorY))
  const configuredAlign = cfg.textAlign === null ? null : sgn(cfg.textAlign)
  const rawAlign = tag.textAlign === undefined ? (cfg.textAlign === undefined ? null : configuredAlign) : tag.textAlign
  const textAlign = rawAlign === null ? anchorX : sgn(rawAlign)
  return { anchorX, anchorY, textAlign, width: finite(tag.width) || finite(cfg.width) || 0 }
}
function anchorAlignment(value: Sgn): 'start' | 'middle' | 'end' { return value === -1 ? 'end' : value === 1 ? 'start' : 'middle' }
export function resolveAarcTextBlockLayout(anchorY: number | undefined, anchor: number, blockHeight: number, primarySize: number) {
  const safeHeight = Math.max(0, blockHeight), safePrimary = Math.max(0, primarySize)
  const top = anchorY === -1 ? anchor - safeHeight : anchorY === 1 ? anchor : anchor - safePrimary
  return { top, baseline: top + safePrimary }
}
function estimateTextWidth(primary: string[], secondary: string[], primarySize: number, secondarySize: number) {
  return Math.max(20, ...primary.map(value => value.length * primarySize * .65), ...secondary.map(value => value.length * secondarySize * .62))
}
function textBlockMetrics(primary: string[], secondary: string[], primarySize: number, secondarySize: number, primaryRow: number, secondaryRow: number, gap = 0) {
  const height = Math.max(primaryRow, primary.length * primaryRow + secondary.length * secondaryRow + (secondary.length ? gap : 0))
  return { width: estimateTextWidth(primary, secondary, primarySize, secondarySize), height }
}

function relativeLuminance(color: string) {
  const raw = color.trim().replace('#', '')
  const expanded = raw.length === 3 ? raw.split('').map(value => value + value).join('') : raw
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return 0
  const component = (offset: number) => {
    const value = parseInt(expanded.slice(offset, offset + 2), 16) / 255
    return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  }
  return .2126 * component(0) + .7152 * component(2) + .0722 * component(4)
}
function inverseBinary(color: string) { return relativeLuminance(color) < .7 ? 'white' : 'black' }
function terrainTextColor(color: string) { return relativeLuminance(color) > .9 ? '#999' : 'white' }

function globalFont(project: ActualRouteProject, secondary = false) {
  return configString(project, secondary ? 'textTagSubFont' : 'textTagFont', '') || 'sans-serif'
}
function globalWeight(project: ActualRouteProject, secondary = false) {
  return configString(project, secondary ? 'textTagSubFontWeight' : 'textTagFontWeight', '') || undefined
}
function globalStyle(project: ActualRouteProject, secondary = false) {
  return configString(project, secondary ? 'textTagSubFontStyle' : 'textTagFontStyle', '') || undefined
}
function baseFontSize(project: ActualRouteProject, secondary = false) { return configNumber(project, secondary ? 'textTagSubFontSizeBase' : 'textTagFontSizeBase', secondary ? 16 : 30) }
function baseRowHeight(project: ActualRouteProject, secondary = false) { return configNumber(project, secondary ? 'textTagSubRowHeightBase' : 'textTagRowHeightBase', secondary ? 18 : 34) }
function optionRatio(tag: AarcTextTag, project: ActualRouteProject, mode: TagMode, secondary = false) {
  const option = secondary ? tag.textSOp : tag.textOp
  const cfg = nestedConfig(project, mode === 'line' ? 'textTagForLine' : mode === 'terrain' ? 'textTagForTerrain' : 'textTagPlain')
  return clampRatio(option?.size, clampRatio(cfg[secondary ? 'subFontSize' : 'fontSize'], 1))
}

function TextBlock({ x, y, params, primaryLines, secondaryLines, primarySize, secondarySize, primaryRow, secondaryRow, primaryColor, secondaryColor, primaryFont, secondaryFont, primaryWeight, secondaryWeight, primaryStyle, secondaryStyle, stroke, strokeWidth, gap = 0, dataKind }: {
  x: number; y: number; params: TagParams; primaryLines: string[]; secondaryLines: string[]; primarySize: number; secondarySize: number; primaryRow: number; secondaryRow: number; primaryColor: string; secondaryColor: string; primaryFont: string; secondaryFont: string; primaryWeight?: string; secondaryWeight?: string; primaryStyle?: string; secondaryStyle?: string; stroke?: string; strokeWidth?: number; gap?: number; dataKind: string
}) {
  if (!primaryLines.length && !secondaryLines.length) return null
  const metrics = textBlockMetrics(primaryLines, secondaryLines, primarySize, secondarySize, primaryRow, secondaryRow, gap)
  const block = resolveAarcTextBlockLayout(params.anchorY, y, metrics.height, primarySize)
  const align = anchorAlignment(params.textAlign)
  return <text x={x} y={block.baseline} textAnchor={align} fontFamily={primaryFont} fontSize={primarySize} fontWeight={primaryWeight} fontStyle={primaryStyle} fill={primaryColor} stroke={stroke} strokeWidth={strokeWidth} paintOrder={stroke ? 'stroke fill' : undefined} strokeLinejoin="round" data-aarc-text-primary="true" data-aarc-text-render-kind={dataKind}>
    {primaryLines.map((value, index) => <tspan key={`p-${index}`} x={x} dy={index === 0 ? 0 : primaryRow}>{value}</tspan>)}
    {secondaryLines.map((value, index) => <tspan key={`s-${index}`} x={x} dy={index === 0 ? secondarySize + gap : secondaryRow} fontFamily={secondaryFont} fontSize={secondarySize} fontWeight={secondaryWeight} fontStyle={secondaryStyle} fill={secondaryColor}>{value}</tspan>)}
  </text>
}

export function resolveAarcIconDimensions(icon: AarcTextTagIcon | undefined, naturalRatio = 1) {
  const width = Math.max(10, finite(icon?.width) ?? 50)
  const ratio = Number.isFinite(naturalRatio) && naturalRatio > 0 ? naturalRatio : 1
  return { width, height: width / ratio }
}
function useIconRatio(icon: AarcTextTagIcon | undefined) {
  const rawWidth = finite(icon?.raw?.naturalWidth), rawHeight = finite(icon?.raw?.naturalHeight)
  const stored = rawWidth && rawHeight ? rawWidth / rawHeight : 1
  const [ratio, setRatio] = useState(stored)
  useEffect(() => {
    if (!icon?.url || (rawWidth && rawHeight) || typeof Image === 'undefined') return
    let active = true
    const image = new Image()
    image.onload = () => { if (active && image.naturalWidth > 0 && image.naturalHeight > 0) setRatio(image.naturalWidth / image.naturalHeight) }
    image.src = icon.url
    return () => { active = false }
  }, [icon?.url, rawWidth, rawHeight])
  return ratio
}
function resolvePlainIconLayout(x: number, y: number, params: TagParams, textWidth: number, textHeight: number, iconWidth: number, iconHeight: number, gap: number) {
  let textX = x, textY = y, iconX = x, iconY = y
  if (params.textAlign === 0) {
    if (params.anchorY === -1) iconY = y - (textHeight + iconHeight / 2) - gap
    else if (params.anchorY === 0) { textY += iconHeight / 2 + gap / 2; iconY = y - textHeight / 2 - gap / 2 }
    else { textY += iconHeight + gap; iconY = y + iconHeight / 2 }
    if (params.anchorX !== 0) {
      const fix = Math.max(0, iconWidth - textWidth) / 2
      if (params.anchorX === -1) { textX -= fix; iconX = x - textWidth / 2 - fix }
      else { textX += fix; iconX = x + textWidth / 2 + fix }
    }
  } else {
    if (params.textAlign === -1) {
      if (params.anchorX === 1) iconX = x + textWidth + iconWidth / 2 + gap
      else if (params.anchorX === 0) { textX -= iconWidth / 2 + gap / 2; iconX = x + textWidth / 2 + gap / 2 }
      else { textX -= iconWidth + gap; iconX = x - iconWidth / 2 }
    } else {
      if (params.anchorX === -1) iconX = x - (textWidth + iconWidth / 2) - gap
      else if (params.anchorX === 0) { textX += iconWidth / 2 + gap / 2; iconX = x - textWidth / 2 - gap / 2 }
      else { textX += iconWidth + gap; iconX = x + iconWidth / 2 }
    }
    if (params.anchorY !== 0) {
      const fix = Math.max(0, iconHeight - textHeight) / 2
      if (params.anchorY === -1) { textY -= fix; iconY = y - textHeight / 2 - fix }
      else { textY += fix; iconY = y + textHeight / 2 + fix }
    }
  }
  return { textX, textY, iconX, iconY }
}

function CommonLineTag({ tag, project, target }: { tag: AarcTextTag; project: ActualRouteProject; target: SourceTarget }) {
  const params = paramsFor(tag, project, 'line')
  const mainRatio = optionRatio(tag, project, 'line') * 1.2, subRatio = optionRatio(tag, project, 'line', true) * 1.2
  const primarySize = baseFontSize(project) * mainRatio, secondarySize = baseFontSize(project, true) * subRatio
  const primaryRow = baseRowHeight(project) * mainRatio, secondaryRow = baseRowHeight(project, true) * subRatio
  const primary = resolveAarcTextTagContent(tag, project), secondary = resolveAarcTextTagContent(tag, project, true)
  const primaryLines = primary ? textLines(primary) : [], secondaryLines = secondary ? textLines(secondary) : []
  const metrics = textBlockMetrics(primaryLines, secondaryLines, primarySize, secondarySize, primaryRow, secondaryRow)
  const cfg = nestedConfig(project, 'textTagForLine')
  const paddingRatio = clampRatio(tag.padding, clampRatio(cfg.padding, 1))
  const paddingLineWidth = configNumber(project, 'lineWidth', 14) * paddingRatio
  const padding = paddingLineWidth / 2
  const edgeOutside = cfg.edgeAnchorOutsidePadding === true
  const x = tag.x + (edgeOutside ? params.anchorX * padding : 0), y = tag.y + (edgeOutside ? params.anchorY * padding : 0)
  const width = params.width > 0 ? params.width : metrics.width
  const align = anchorAlignment(params.textAlign)
  const block = resolveAarcTextBlockLayout(params.anchorY, y, metrics.height, primarySize)
  const rectX = align === 'start' ? x : align === 'end' ? x - width : x - width / 2
  const textColor = target.tagTextColor ?? inverseBinary(target.color)
  const cfgDropCap = sourceConfig(project).textTagForLineDropCap
  const dropCap = tag.dropCap ?? (typeof cfgDropCap === 'boolean' ? cfgDropCap : true)
  const detect = sourceConfig(project).textTagForLineDropCapDetect === 'loose' ? 'loose' : 'classic'
  const dropCapPart = resolveAarcDropCap({ ...tag, dropCap, raw: { ...tag.raw, dropCapDetect: detect } }, primary, secondary)
  return <>
    <rect x={rectX} y={block.top} width={width} height={metrics.height} fill={target.color} stroke={padding > 0 ? target.color : undefined} strokeWidth={paddingLineWidth} data-aarc-line-name-carpet="true" />
    <TextBlock x={x} y={y} params={params} primaryLines={primaryLines} secondaryLines={secondaryLines} primarySize={primarySize} secondarySize={secondarySize} primaryRow={primaryRow} secondaryRow={secondaryRow} primaryColor={textColor} secondaryColor={textColor} primaryFont={globalFont(project)} secondaryFont={globalFont(project, true)} dataKind="line" />
    {dropCap && primaryLines[0] && <title>dropCap {dropCapPart ?? tag.dropCapLength ?? detect}</title>}
  </>
}

function TerrainTag({ tag, project, target }: { tag: AarcTextTag; project: ActualRouteProject; target: SourceTarget }) {
  const params = paramsFor(tag, project, 'terrain')
  const mainRatio = optionRatio(tag, project, 'terrain') * 1.2, subRatio = optionRatio(tag, project, 'terrain', true) * 1.2
  const primarySize = baseFontSize(project) * mainRatio, secondarySize = baseFontSize(project, true) * subRatio
  const primaryRow = baseRowHeight(project) * mainRatio, secondaryRow = baseRowHeight(project, true) * subRatio
  const primary = resolveAarcTextTagContent(tag, project), secondary = resolveAarcTextTagContent(tag, project, true)
  return <TextBlock x={tag.x} y={tag.y} params={params} primaryLines={primary ? textLines(primary) : []} secondaryLines={secondary ? textLines(secondary) : []} primarySize={primarySize} secondarySize={secondarySize} primaryRow={primaryRow} secondaryRow={secondaryRow} primaryColor={terrainTextColor(target.color)} secondaryColor={terrainTextColor(target.color)} primaryFont={globalFont(project)} secondaryFont={globalFont(project, true)} stroke={target.color} strokeWidth={primarySize / 4} dataKind="terrain" />
}

function PlainTag({ tag, project }: { tag: AarcTextTag; project: ActualRouteProject }) {
  const params = paramsFor(tag, project, 'plain')
  const mainRatio = optionRatio(tag, project, 'plain'), subRatio = optionRatio(tag, project, 'plain', true)
  const primarySize = baseFontSize(project) * mainRatio, secondarySize = baseFontSize(project, true) * subRatio
  const primaryRow = baseRowHeight(project) * mainRatio, secondaryRow = baseRowHeight(project, true) * subRatio
  const rawPrimary = (tag.textOverride ?? tag.text ?? '').trim(), rawSecondary = (tag.textSOverride ?? tag.textS ?? '').trim()
  const mainEmpty = !rawPrimary, subEmpty = mainEmpty && !rawSecondary
  const primary = !mainEmpty ? rawPrimary : '空文本标签', secondary = !subEmpty ? rawSecondary : 'Empty TextTag'
  const primaryLines = primary ? textLines(primary) : [], secondaryLines = secondary ? textLines(secondary) : []
  const primaryOption = tag.textOp, secondaryOption = tag.textSOp
  const primaryColor = primaryOption?.color || configString(project, 'textTagFontColorHex', '#333333')
  const secondaryColor = secondaryOption?.color || configString(project, 'textTagSubFontColorHex', '#999999')
  const primaryFont = primaryOption?.font?.trim() || globalFont(project), secondaryFont = secondaryOption?.font?.trim() || globalFont(project, true)
  const primaryWeight = primaryOption?.weight || globalWeight(project), secondaryWeight = secondaryOption?.weight || globalWeight(project, true)
  const primaryStyle = primaryOption?.style || globalStyle(project), secondaryStyle = secondaryOption?.style || globalStyle(project, true)
  const metrics = textBlockMetrics(primaryLines, secondaryLines, primarySize, secondarySize, primaryRow, secondaryRow)
  const icon = tag.iconId ? project.aarc?.textTagIcons?.find(item => item.id === tag.iconId) : undefined
  const ratio = useIconRatio(icon), dimensions = resolveAarcIconDimensions(icon, ratio)
  const iconValid = Boolean(icon?.url), onlyIcon = mainEmpty
  const gap = onlyIcon ? 0 : mainRatio * 7
  const layout = iconValid ? resolvePlainIconLayout(tag.x, tag.y, params, metrics.width, metrics.height, dimensions.width, dimensions.height, gap) : { textX: tag.x, textY: tag.y, iconX: tag.x, iconY: tag.y }
  const stroke = tag.removeCarpet ? undefined : configString(project, 'bgColor', '#ffffff')
  return <>
    {!(iconValid && onlyIcon) && <TextBlock x={layout.textX} y={layout.textY} params={params} primaryLines={primaryLines} secondaryLines={secondaryLines} primarySize={primarySize} secondarySize={secondarySize} primaryRow={primaryRow} secondaryRow={secondaryRow} primaryColor={primaryColor} secondaryColor={secondaryColor} primaryFont={primaryFont} secondaryFont={secondaryFont} primaryWeight={primaryWeight} secondaryWeight={secondaryWeight} primaryStyle={primaryStyle} secondaryStyle={secondaryStyle} stroke={stroke} strokeWidth={stroke ? primarySize / 4 : undefined} dataKind="plain" />}
    {iconValid && <image href={icon!.url} x={layout.iconX - dimensions.width / 2} y={layout.iconY - dimensions.height / 2} width={dimensions.width} height={dimensions.height} preserveAspectRatio="xMidYMid meet" data-aarc-icon-id={icon!.id} data-aarc-icon-natural-ratio={ratio} />}
  </>
}

function Tag({ tag, project }: { tag: AarcTextTag; project: ActualRouteProject }) {
  const target = sourceTarget(project, tag)
  const mode: TagMode = target?.mode ?? 'plain'
  const opacity = tag.opacity || 1, rotation = (tag.rotation ?? 0) * 180 / Math.PI
  return <g data-aarc-text-tag-id={tag.id} data-aarc-text-tag-kind={tag.kind} data-aarc-text-tag-render-mode={mode} data-text-tag-id={tag.id} data-line-id={tag.lineId ?? ''} opacity={opacity} transform={`rotate(${rotation} ${tag.x} ${tag.y})`}>
    {mode === 'line' && target ? <CommonLineTag tag={tag} project={project} target={target} /> : mode === 'terrain' && target ? <TerrainTag tag={tag} project={project} target={target} /> : <PlainTag tag={tag} project={project} />}
  </g>
}

export const AarcTextTagsLayer = memo(function AarcTextTagsLayer({ project, presentation = false, visibleLineIds, mode = 'notSunken' }: { project: ActualRouteProject; presentation?: boolean; visibleLineIds?: Set<string>; mode?: LayerMode }) {
  const tags = (project.textTags ?? [])
    .map((tag, index) => ({ tag, index }))
    .filter(({ tag }) => (mode === 'sunken' ? tag.sunken === true : tag.sunken !== true) && (!presentation || !tag.lineId || !visibleLineIds || visibleLineIds.has(tag.lineId)))
    .sort((a, b) => (a.tag.zIndex ?? 0) - (b.tag.zIndex ?? 0) || a.index - b.index)
    .map(({ tag }) => tag)
  if (!tags.length) return null
  const layerName = mode === 'sunken' ? 'aarc-text-tags-sunken' : 'aarc-text-tags'
  return <g data-layer={layerName} data-aarc-text-tag-layer={mode} data-presentation-layer={presentation ? layerName : undefined} pointerEvents="none">{tags.map(tag => <Tag key={tag.id} tag={tag} project={project} />)}</g>
})
