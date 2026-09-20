import { memo, useEffect, useState } from 'react'
import type { AarcTextTag, AarcTextTagIcon, ActualRouteProject, Line } from '../data/model'
import { getEffectiveLineColor } from '../data/lineIdentity'

function textLines(value: string) {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}
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
interface FontSpec { family: string; size: number; weight?: string; style?: string }
interface TextMetricsBlock { mainHeight: number; subHeight: number; totalHeight: number; mainWidth: number; width: number }

const finite = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const sourceConfig = (project: ActualRouteProject) => record(project.aarc?.config ?? record(project.aarc?.raw).config)
function nestedConfig(project: ActualRouteProject, key: 'textTagPlain' | 'textTagForLine' | 'textTagForTerrain') {
  const cfg = { ...record(sourceConfig(project)[key]) }
  if (key === 'textTagForLine' && (finite(sourceConfig(project).configVersion) ?? 0) < 1) {
    if (cfg.anchorX === undefined) cfg.anchorX = 1
    if (cfg.textAlign === undefined) cfg.textAlign = 0
  }
  return cfg
}
const configString = (project: ActualRouteProject, key: string, fallback: string) => typeof sourceConfig(project)[key] === 'string' ? sourceConfig(project)[key] as string : fallback
const configNumber = (project: ActualRouteProject, key: string, fallback: number) => finite(sourceConfig(project)[key]) ?? fallback
const clampRatio = (value: unknown, fallback: number) => {
  const n = finite(value)
  if (n === undefined) return fallback
  return Math.max(0, Math.min(16, n)) || fallback
}
const sgn = (value: unknown, fallback: Sgn = 0): Sgn => value === -1 || value === 0 || value === 1 ? value : fallback
const fontCss = (font: FontSpec) => `${font.style || 'normal'} ${font.weight || 'normal'} ${font.size}px ${font.family || 'sans-serif'}`

let measureCanvas: HTMLCanvasElement | undefined
function measureTextWidth(text: string, font: FontSpec) {
  if (!text) return 0
  if (typeof document !== 'undefined' && !(typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent))) {
    try {
      measureCanvas ??= document.createElement('canvas')
      const ctx = measureCanvas.getContext('2d')
      if (ctx) {
        ctx.font = fontCss(font)
        const width = ctx.measureText(text).width
        if (Number.isFinite(width)) return width
      }
    } catch { /* deterministic fallback below */ }
  }
  return text.length * font.size * .62
}
function measureTextBlock(primaryLines: string[], secondaryLines: string[], primary: FontSpec, secondary: FontSpec, primaryRow: number, secondaryRow: number): TextMetricsBlock {
  const mainHeight = primaryLines.length * primaryRow
  const subHeight = secondaryLines.length * secondaryRow
  const mainWidth = Math.max(0, ...primaryLines.map(line => measureTextWidth(line, primary)))
  const width = Math.max(mainWidth, ...secondaryLines.map(line => measureTextWidth(line, secondary)), 0)
  return { mainHeight, subHeight, totalHeight: mainHeight + subHeight, mainWidth, width }
}
function textYTop(y: number, anchorY: Sgn, metrics: TextMetricsBlock, primarySize: number, secondarySize: number) {
  const mainRowMargin = metrics.mainHeight ? metrics.mainHeight / Math.max(1, metrics.mainHeight / primarySize) - primarySize : 0
  const subRowMargin = metrics.subHeight ? metrics.subHeight / Math.max(1, metrics.subHeight / secondarySize) - secondarySize : 0
  if (anchorY === -1) return y - metrics.totalHeight + subRowMargin / 2
  if (anchorY === 0) return y - metrics.totalHeight / 2
  return y - mainRowMargin / 2
}
function exactTextYTop(y: number, anchorY: Sgn, totalHeight: number, primaryRow: number, primarySize: number, secondaryRow: number, secondarySize: number) {
  if (anchorY === -1) return y - totalHeight + (secondaryRow - secondarySize) / 2
  if (anchorY === 0) return y - totalHeight / 2
  return y - (primaryRow - primarySize) / 2
}
function rectTop(y: number, anchorY: Sgn, height: number) { return anchorY === -1 ? y - height : anchorY === 0 ? y - height / 2 : y }
function rectLeft(x: number, anchorX: Sgn, width: number) { return anchorX === -1 ? x - width : anchorX === 0 ? x - width / 2 : x }
function textAlignName(value: Sgn): 'start' | 'middle' | 'end' { return value === -1 ? 'end' : value === 1 ? 'start' : 'middle' }

export function resolveAarcDropCap(tag: AarcTextTag, primary: string, secondary: string, detect: 'classic' | 'loose' = 'classic'): string | undefined {
  if (!tag.dropCap) return undefined
  if (typeof tag.dropCapLength === 'number') {
    return tag.dropCapLength > 0 && tag.dropCapLength <= primary.length ? primary.slice(0, tag.dropCapLength) : undefined
  }
  if (!secondary) return undefined
  const match = (detect === 'loose' ? LOOSE_DROP_CAP : CLASSIC_DROP_CAP).exec(primary)
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
      mode: 'terrain', sourceId,
      name: typeof raw?.name === 'string' && raw.name ? raw.name : path?.name ?? '未命名地形',
      nameSub: typeof raw?.nameSub === 'string' ? raw.nameSub : '',
      color: path?.color ?? (typeof raw?.color === 'string' && raw.color ? raw.color : '#64748b'),
    }
  }
  return {
    mode: 'line', sourceId, line: native,
    name: native?.name ?? (typeof raw?.name === 'string' && raw.name ? raw.name : '未命名线路'),
    nameSub: native?.nameSub ?? (typeof raw?.nameSub === 'string' ? raw.nameSub : ''),
    color: native ? getEffectiveLineColor(project, native) : (typeof raw?.color === 'string' && raw.color ? raw.color : '#64748b'),
    ...(typeof raw?.tagTextColor === 'string' && raw.tagTextColor ? { tagTextColor: raw.tagTextColor } : {}),
  }
}
function boundLineId(project: ActualRouteProject, tag: AarcTextTag) {
  if (tag.lineId) return tag.lineId
  const target = sourceTarget(project, tag)
  return target?.mode === 'line' ? target.line?.id : undefined
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

export function resolveAarcTextTagParams(tag: AarcTextTag, project: ActualRouteProject, mode: TagMode): TagParams {
  const cfg = nestedConfig(project, mode === 'line' ? 'textTagForLine' : mode === 'terrain' ? 'textTagForTerrain' : 'textTagPlain')
  const anchorX = sgn(tag.anchorX, sgn(cfg.anchorX))
  const anchorY = sgn(tag.anchorY, sgn(cfg.anchorY))
  const configuredAlign = cfg.textAlign === null ? null : sgn(cfg.textAlign)
  const rawAlign = tag.textAlign === undefined ? (cfg.textAlign === undefined ? null : configuredAlign) : tag.textAlign
  const textAlign = rawAlign === null ? anchorX : sgn(rawAlign)
  return { anchorX, anchorY, textAlign, width: finite(tag.width) || finite(cfg.width) || 0 }
}
export function resolveAarcTextBlockLayout(anchorY: number | undefined, anchor: number, blockHeight: number, primarySize: number) {
  const safeHeight = Math.max(0, blockHeight), safePrimary = Math.max(0, primarySize)
  const top = anchorY === -1 ? anchor - safeHeight : anchorY === 1 ? anchor : anchor - safePrimary
  return { top, baseline: top + safePrimary }
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
function globalFont(project: ActualRouteProject, secondary = false) { return configString(project, secondary ? 'textTagSubFont' : 'textTagFont', '') || 'sans-serif' }
function globalWeight(project: ActualRouteProject, secondary = false) { return configString(project, secondary ? 'textTagSubFontWeight' : 'textTagFontWeight', '') || undefined }
function globalStyle(project: ActualRouteProject, secondary = false) { return configString(project, secondary ? 'textTagSubFontStyle' : 'textTagFontStyle', '') || undefined }
function baseFontSize(project: ActualRouteProject, secondary = false) { return configNumber(project, secondary ? 'textTagSubFontSizeBase' : 'textTagFontSizeBase', secondary ? 16 : 30) }
function baseRowHeight(project: ActualRouteProject, secondary = false) { return configNumber(project, secondary ? 'textTagSubRowHeightBase' : 'textTagRowHeightBase', secondary ? 18 : 34) }
function optionRatio(tag: AarcTextTag, project: ActualRouteProject, mode: TagMode, secondary = false) {
  const option = secondary ? tag.textSOp : tag.textOp
  const cfg = nestedConfig(project, mode === 'line' ? 'textTagForLine' : mode === 'terrain' ? 'textTagForTerrain' : 'textTagPlain')
  return clampRatio(option?.size, clampRatio(cfg[secondary ? 'subFontSize' : 'fontSize'], 1))
}

function TextBlock({ x, y, params, primaryLines, secondaryLines, primaryFont, secondaryFont, primaryRow, secondaryRow, primaryColor, secondaryColor, stroke, strokeWidth, dataKind }: {
  x: number; y: number; params: TagParams; primaryLines: string[]; secondaryLines: string[]; primaryFont: FontSpec; secondaryFont: FontSpec; primaryRow: number; secondaryRow: number; primaryColor: string; secondaryColor: string; stroke?: string; strokeWidth?: number; dataKind: string
}) {
  if (!primaryLines.length && !secondaryLines.length) return null
  const metrics = measureTextBlock(primaryLines, secondaryLines, primaryFont, secondaryFont, primaryRow, secondaryRow)
  const yTop = exactTextYTop(y, params.anchorY, metrics.totalHeight, primaryRow, primaryFont.size, secondaryRow, secondaryFont.size)
  const xOffset = (params.textAlign - params.anchorX) * metrics.width / 2
  const useX = x - xOffset
  const anchor = textAlignName(params.textAlign)
  return <g data-aarc-text-render-kind={dataKind} data-aarc-measured-width={metrics.width}>
    {primaryLines.map((value, index) => <text key={`p-${index}`} x={useX} y={yTop + (index + .5) * primaryRow} dominantBaseline="middle" textAnchor={anchor} fontFamily={primaryFont.family} fontSize={primaryFont.size} fontWeight={primaryFont.weight} fontStyle={primaryFont.style} fill={primaryColor} stroke={stroke} strokeWidth={strokeWidth} paintOrder={stroke ? 'stroke fill' : undefined} strokeLinejoin="round" data-aarc-text-primary="true">{value}</text>)}
    {secondaryLines.map((value, index) => <text key={`s-${index}`} x={useX} y={yTop + metrics.mainHeight + (index + .5) * secondaryRow} dominantBaseline="middle" textAnchor={anchor} fontFamily={secondaryFont.family} fontSize={secondaryFont.size} fontWeight={secondaryFont.weight} fontStyle={secondaryFont.style} fill={secondaryColor} stroke={stroke} strokeWidth={strokeWidth} paintOrder={stroke ? 'stroke fill' : undefined} strokeLinejoin="round" data-aarc-text-secondary="true">{value}</text>)}
  </g>
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
  const params = resolveAarcTextTagParams(tag, project, 'line')
  const mainRatio = optionRatio(tag, project, 'line') * 1.2, subRatio = optionRatio(tag, project, 'line', true) * 1.2
  const primaryFont: FontSpec = { family: globalFont(project), size: baseFontSize(project) * mainRatio }
  const secondaryFont: FontSpec = { family: globalFont(project, true), size: baseFontSize(project, true) * subRatio }
  const primaryRow = baseRowHeight(project) * mainRatio, secondaryRow = baseRowHeight(project, true) * subRatio
  const primary = resolveAarcTextTagContent(tag, project), secondary = resolveAarcTextTagContent(tag, project, true)
  const primaryLines = textLines(primary), secondaryLines = textLines(secondary)
  const metrics = measureTextBlock(primaryLines, secondaryLines, primaryFont, secondaryFont, primaryRow, secondaryRow)
  const cfg = nestedConfig(project, 'textTagForLine')
  const paddingRatio = clampRatio(tag.padding, clampRatio(cfg.padding, 1))
  const paddingLineWidth = configNumber(project, 'lineWidth', 14) * paddingRatio
  const padding = paddingLineWidth / 2
  const edgeOutside = cfg.edgeAnchorOutsidePadding === true
  const x = tag.x + (edgeOutside ? params.anchorX * padding : 0), y = tag.y + (edgeOutside ? params.anchorY * padding : 0)
  const textColor = target.tagTextColor ?? inverseBinary(target.color)
  const cfgDropCap = sourceConfig(project).textTagForLineDropCap
  const dropCapEnabled = tag.dropCap ?? (typeof cfgDropCap === 'boolean' ? cfgDropCap : true)
  const detect: 'classic' | 'loose' = sourceConfig(project).textTagForLineDropCapDetect === 'loose' ? 'loose' : 'classic'
  const dropTag = { ...tag, dropCap: dropCapEnabled }
  const dropCapPart = resolveAarcDropCap(dropTag, primary, secondary, detect)

  if (dropCapPart) {
    const rest = primary.trim().slice(dropCapPart.length).trim()
    const totalHeight = primaryRow + secondaryRow
    const giantSize = primaryFont.size + secondaryFont.size + (primaryRow - primaryFont.size + secondaryRow - secondaryFont.size)
    const giantFont: FontSpec = { family: primaryFont.family, size: giantSize }
    const giantWidth = measureTextWidth(dropCapPart, giantFont)
    const margin = giantSize * .05
    const restWidth = measureTextWidth(rest, primaryFont) + margin
    const subWidth = measureTextWidth(secondary.trim(), secondaryFont) + margin * 2
    const naturalWidth = giantWidth + Math.max(restWidth, subWidth)
    const rectWidth = Math.max(naturalWidth, params.width)
    const xLeft = rectLeft(x, params.anchorX, naturalWidth)
    const yTop = params.anchorY === -1 ? y - totalHeight : params.anchorY === 0 ? y - totalHeight / 2 : y
    return <>
      <rect x={rectLeft(x, params.anchorX, rectWidth)} y={rectTop(y, params.anchorY, totalHeight)} width={rectWidth} height={totalHeight} fill={target.color} stroke={padding > 0 ? target.color : undefined} strokeWidth={paddingLineWidth} strokeLinejoin="round" data-aarc-line-name-carpet="true" data-aarc-width-mode="minimum" data-aarc-carpet-shape="fill-rect-round-stroke" />
      <g data-aarc-text-render-kind="line-dropcap" data-aarc-dropcap-part={dropCapPart}>
        <text x={xLeft} y={yTop + totalHeight / 2} dominantBaseline="middle" textAnchor="start" fontFamily={giantFont.family} fontSize={giantFont.size} fill={textColor}>{dropCapPart}</text>
        <text x={xLeft + giantWidth + margin} y={yTop + primaryRow / 2} dominantBaseline="middle" textAnchor="start" fontFamily={primaryFont.family} fontSize={primaryFont.size} fill={textColor}>{rest}</text>
        {secondary.trim() && <text x={xLeft + giantWidth + margin * 2} y={yTop + primaryRow + secondaryRow / 2} dominantBaseline="middle" textAnchor="start" fontFamily={secondaryFont.family} fontSize={secondaryFont.size} fill={textColor}>{secondary.trim()}</text>}
      </g>
    </>
  }

  const rectWidth = Math.max(metrics.width, params.width)
  return <>
    <rect x={rectLeft(x, params.anchorX, rectWidth)} y={rectTop(y, params.anchorY, metrics.totalHeight)} width={rectWidth} height={metrics.totalHeight} fill={target.color} stroke={padding > 0 ? target.color : undefined} strokeWidth={paddingLineWidth} strokeLinejoin="round" data-aarc-line-name-carpet="true" data-aarc-width-mode="minimum" data-aarc-carpet-shape="fill-rect-round-stroke" />
    <TextBlock x={x} y={y} params={params} primaryLines={primaryLines} secondaryLines={secondaryLines} primaryFont={primaryFont} secondaryFont={secondaryFont} primaryRow={primaryRow} secondaryRow={secondaryRow} primaryColor={textColor} secondaryColor={textColor} dataKind="line" />
  </>
}

function TerrainTag({ tag, project, target }: { tag: AarcTextTag; project: ActualRouteProject; target: SourceTarget }) {
  const params = resolveAarcTextTagParams(tag, project, 'terrain')
  const mainRatio = optionRatio(tag, project, 'terrain') * 1.2, subRatio = optionRatio(tag, project, 'terrain', true) * 1.2
  const primaryFont: FontSpec = { family: globalFont(project), size: baseFontSize(project) * mainRatio }
  const secondaryFont: FontSpec = { family: globalFont(project, true), size: baseFontSize(project, true) * subRatio }
  const primaryRow = baseRowHeight(project) * mainRatio, secondaryRow = baseRowHeight(project, true) * subRatio
  const primary = resolveAarcTextTagContent(tag, project), secondary = resolveAarcTextTagContent(tag, project, true)
  return <TextBlock x={tag.x} y={tag.y} params={params} primaryLines={textLines(primary)} secondaryLines={textLines(secondary)} primaryFont={primaryFont} secondaryFont={secondaryFont} primaryRow={primaryRow} secondaryRow={secondaryRow} primaryColor={terrainTextColor(target.color)} secondaryColor={terrainTextColor(target.color)} stroke={target.color} strokeWidth={primaryFont.size / 4} dataKind="terrain" />
}

function PlainTag({ tag, project }: { tag: AarcTextTag; project: ActualRouteProject }) {
  const params = resolveAarcTextTagParams(tag, project, 'plain')
  const mainRatio = optionRatio(tag, project, 'plain'), subRatio = optionRatio(tag, project, 'plain', true)
  const primaryOption = tag.textOp, secondaryOption = tag.textSOp
  const primaryFont: FontSpec = { family: primaryOption?.font?.trim() || globalFont(project), size: baseFontSize(project) * mainRatio, weight: primaryOption?.weight || globalWeight(project), style: primaryOption?.style || globalStyle(project) }
  const secondaryFont: FontSpec = { family: secondaryOption?.font?.trim() || globalFont(project, true), size: baseFontSize(project, true) * subRatio, weight: secondaryOption?.weight || globalWeight(project, true), style: secondaryOption?.style || globalStyle(project, true) }
  const primaryRow = baseRowHeight(project) * mainRatio, secondaryRow = baseRowHeight(project, true) * subRatio
  const rawPrimary = (tag.textOverride ?? tag.text ?? '').trim(), rawSecondary = (tag.textSOverride ?? tag.textS ?? '').trim()
  const mainEmpty = !rawPrimary, subEmpty = mainEmpty && !rawSecondary
  const primary = !mainEmpty ? rawPrimary : '空文本标签', secondary = !subEmpty ? rawSecondary : 'Empty TextTag'
  const primaryLines = textLines(primary), secondaryLines = textLines(secondary)
  const primaryColor = primaryOption?.color || configString(project, 'textTagFontColorHex', '#333333')
  const secondaryColor = secondaryOption?.color || configString(project, 'textTagSubFontColorHex', '#999999')
  const metrics = measureTextBlock(primaryLines, secondaryLines, primaryFont, secondaryFont, primaryRow, secondaryRow)
  const icon = tag.iconId ? project.aarc?.textTagIcons?.find(item => item.id === tag.iconId) : undefined
  const ratio = useIconRatio(icon), dimensions = resolveAarcIconDimensions(icon, ratio)
  const iconValid = Boolean(icon?.url), onlyIcon = mainEmpty
  const gap = onlyIcon ? 0 : mainRatio * 7
  const layout = iconValid ? resolvePlainIconLayout(tag.x, tag.y, params, metrics.width, metrics.totalHeight, dimensions.width, dimensions.height, gap) : { textX: tag.x, textY: tag.y, iconX: tag.x, iconY: tag.y }
  const stroke = tag.removeCarpet ? undefined : configString(project, 'bgColor', '#ffffff')
  return <>
    {!(iconValid && onlyIcon) && <TextBlock x={layout.textX} y={layout.textY} params={params} primaryLines={primaryLines} secondaryLines={secondaryLines} primaryFont={primaryFont} secondaryFont={secondaryFont} primaryRow={primaryRow} secondaryRow={secondaryRow} primaryColor={primaryColor} secondaryColor={secondaryColor} stroke={stroke} strokeWidth={stroke ? primaryFont.size / 4 : undefined} dataKind="plain" />}
    {iconValid && <image href={icon!.url} x={layout.iconX - dimensions.width / 2} y={layout.iconY - dimensions.height / 2} width={dimensions.width} height={dimensions.height} preserveAspectRatio="xMidYMid meet" data-aarc-icon-id={icon!.id} data-aarc-icon-natural-ratio={ratio} />}
  </>
}

function Tag({ tag, project, selectedId, hitRadius = 22, onLineLabelPointerDown }: { tag: AarcTextTag; project: ActualRouteProject; selectedId?: string; hitRadius?: number; onLineLabelPointerDown?: (event: React.PointerEvent<SVGGElement>, tag: AarcTextTag, lineId: string) => void }) {
  const target = sourceTarget(project, tag)
  const mode: TagMode = target?.mode ?? 'plain'
  const opacity = tag.opacity || 1, rotation = (tag.rotation ?? 0) * 180 / Math.PI
  const lineId = boundLineId(project, tag)
  const isLineLabel = mode === 'line' && Boolean(lineId)
  return <g className={isLineLabel ? `map-element line-label aarc-line-label ${selectedId === tag.id ? 'selected' : ''}` : undefined} data-line-label-id={isLineLabel ? tag.id : undefined} data-line-label-source={isLineLabel ? 'aarc' : undefined} data-aarc-text-tag-id={tag.id} data-aarc-text-tag-kind={tag.kind} data-aarc-text-tag-render-mode={mode} data-text-tag-id={tag.id} data-line-id={lineId ?? ''} opacity={opacity} transform={`rotate(${rotation} ${tag.x} ${tag.y})`} onPointerDown={isLineLabel && lineId ? event => onLineLabelPointerDown?.(event, tag, lineId) : undefined}>
    {mode === 'line' && target ? <CommonLineTag tag={tag} project={project} target={target} /> : mode === 'terrain' && target ? <TerrainTag tag={tag} project={project} target={target} /> : <PlainTag tag={tag} project={project} />}
    {isLineLabel && onLineLabelPointerDown && <rect data-editor="true" x={tag.x - hitRadius} y={tag.y - hitRadius} width={hitRadius * 2} height={hitRadius * 2} fill="transparent" pointerEvents="all" />}
  </g>
}

export const AarcTextTagsLayer = memo(function AarcTextTagsLayer({ project, presentation = false, visibleLineIds, mode = 'notSunken', selectedId, hitRadius = 22, onLineLabelPointerDown }: { project: ActualRouteProject; presentation?: boolean; visibleLineIds?: Set<string>; mode?: LayerMode; selectedId?: string; hitRadius?: number; onLineLabelPointerDown?: (event: React.PointerEvent<SVGGElement>, tag: AarcTextTag, lineId: string) => void }) {
  const tags = (project.textTags ?? [])
    .map((tag, index) => ({ tag, index, boundLineId: boundLineId(project, tag) }))
    .filter(({ tag, boundLineId: lineId }) => (mode === 'sunken' ? tag.sunken === true : tag.sunken !== true) && (!presentation || !lineId || !visibleLineIds || visibleLineIds.has(lineId)))
    .sort((a, b) => (a.tag.zIndex ?? 0) - (b.tag.zIndex ?? 0) || a.index - b.index)
    .map(({ tag }) => tag)
  if (!tags.length) return null
  const layerName = mode === 'sunken' ? 'aarc-text-tags-sunken' : 'aarc-text-tags'
  return <g data-layer={layerName} data-aarc-text-tag-layer={mode} data-presentation-layer={presentation ? layerName : undefined} pointerEvents={onLineLabelPointerDown ? 'visiblePainted' : 'none'}>{tags.map(tag => <Tag key={tag.id} tag={tag} project={project} selectedId={selectedId} hitRadius={hitRadius} onLineLabelPointerDown={onLineLabelPointerDown} />)}</g>
})
