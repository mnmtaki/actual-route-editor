import { memo } from 'react'
import type { AarcTextTag, ActualRouteProject } from '../data/model'
import { getEffectiveLineColor } from '../data/lineIdentity'

function textLines(value: string) { return value.split(/\r?\n/) }
const CLASSIC_DROP_CAP = /^[0-9a-zA-Z]{1,3}(?=\s?号?环?线$)/
const LOOSE_DROP_CAP = /^[0-9a-zA-Z]{1,10}(?=.*号?环?线$)/

export function resolveAarcDropCap(tag: AarcTextTag, primary: string, secondary: string): string | undefined {
  if (!tag.dropCap || !secondary) return undefined
  if (typeof tag.dropCapLength === 'number' && tag.dropCapLength > 0 && tag.dropCapLength <= primary.length) return primary.slice(0, tag.dropCapLength)
  const mode = tag.raw?.dropCapDetect === 'loose' ? LOOSE_DROP_CAP : CLASSIC_DROP_CAP
  const match = mode.exec(primary)
  return match?.[0] || undefined
}

function anchorAlignment(tag: AarcTextTag): 'start' | 'middle' | 'end' {
  const value = tag.textAlign === null ? tag.anchorX ?? 0 : tag.textAlign ?? tag.anchorX ?? 0
  return value === -1 ? 'end' : value === 1 ? 'start' : 'middle'
}
export function resolveAarcTextBlockLayout(anchorY: number | undefined, anchor: number, blockHeight: number, primarySize: number) {
  const safeHeight = Math.max(0, blockHeight), safePrimary = Math.max(0, primarySize)
  // AARC uses -1=above, 0=the legacy baseline-centered default, +1=below.
  // Keeping the zero case's historical baseline preserves existing imports;
  // explicit vertical anchors still apply to the complete bilingual block.
  const top = anchorY === -1 ? anchor - safeHeight : anchorY === 1 ? anchor : anchor - safePrimary
  return { top, baseline: top + safePrimary }
}
function normalizedOptionSize(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.max(0, Math.min(16, n)) || 1
}
function normalizedPadding(tag: AarcTextTag) {
  const n = typeof tag.padding === 'number' ? tag.padding : Number(tag.padding)
  if (!Number.isFinite(n)) return tag.kind === 'LineNameLabel' ? 1 : 0
  return Math.max(0, Math.min(16, n)) || (tag.kind === 'LineNameLabel' ? 1 : 0)
}
export function resolveAarcTextTagContent(tag: AarcTextTag, project: ActualRouteProject, secondary = false) {
  const line = tag.lineId ? project.lines.find(item => item.id === tag.lineId) : undefined
  const override = secondary ? tag.textSOverride : tag.textOverride
  if (override !== undefined) return override
  if (line) return secondary ? line.nameSub ?? (line.source?.raw?.nameSub as string | undefined) ?? '' : line.name
  return secondary ? tag.textS ?? '' : tag.text ?? ''
}
function optionFont(tag: AarcTextTag, secondary = false) {
  const option = secondary ? tag.textSOp : tag.textOp
  return typeof option?.font === 'string' && option.font.trim() ? option.font : 'sans-serif'
}
function optionWeight(tag: AarcTextTag, secondary = false, lineLabel = false) {
  const value = (secondary ? tag.textSOp : tag.textOp)?.weight
  return value || (lineLabel ? '700' : '400')
}
function optionSize(tag: AarcTextTag, project: ActualRouteProject, secondary = false) {
  const option = secondary ? tag.textSOp : tag.textOp
  const multiplier = normalizedOptionSize(option?.size)
  return Math.max(4, project.settings.stationLabelSize * multiplier * (secondary ? .72 : 1))
}
function Tag({ tag, project }: { tag: AarcTextTag; project: ActualRouteProject; presentation: boolean }) {
  const line = tag.lineId ? project.lines.find(item => item.id === tag.lineId) : undefined
  const primary = resolveAarcTextTagContent(tag, project), secondary = resolveAarcTextTagContent(tag, project, true)
  const primaryLines = primary ? textLines(primary) : [], secondaryLines = secondary ? textLines(secondary) : []
  const dropCapPart = resolveAarcDropCap(tag, primary, secondary)
  const align = anchorAlignment(tag), primarySize = optionSize(tag, project), secondarySize = optionSize(tag, project, true)
  const lineColor = line ? getEffectiveLineColor(project, line) : '#4b5563'
  const primaryOption = tag.textOp, secondaryOption = tag.textSOp
  const primaryColor = primaryOption?.color || (tag.kind === 'LineNameLabel' ? '#fff' : '#303633')
  const secondaryColor = secondaryOption?.color || '#999999'
  const opacity = tag.opacity ?? 1, rotation = (tag.rotation ?? 0) * 180 / Math.PI
  const padding = normalizedPadding(tag)
  const rowHeight = primarySize * 1.18
  const estimatedWidth = tag.width && tag.width > 0 ? tag.width : Math.max(20, ...primaryLines.map(value => value.length * primarySize * .65), ...secondaryLines.map(value => value.length * secondarySize * .62))
  const secondaryAdvance = secondarySize * 1.18
  const height = Math.max(rowHeight, primaryLines.length * rowHeight + secondaryLines.length * secondaryAdvance + (secondaryLines.length ? padding : 0))
  const x = tag.x, y = tag.y
  const block = resolveAarcTextBlockLayout(tag.anchorY, y, height, primarySize)
  const rectX = align === 'start' ? x - padding : align === 'end' ? x - estimatedWidth - padding : x - estimatedWidth / 2 - padding
  const icon = tag.iconId ? project.aarc?.textTagIcons?.find(item => item.id === tag.iconId) : undefined
  return <g data-aarc-text-tag-id={tag.id} data-aarc-text-tag-kind={tag.kind} data-text-tag-id={tag.id} data-line-id={tag.lineId ?? ''} data-aarc-drop-cap={dropCapPart ?? (tag.dropCap ? String(tag.dropCapLength ?? true) : undefined)} opacity={opacity} transform={`rotate(${rotation} ${x} ${y})`}>
    {tag.kind === 'LineNameLabel' && <rect x={rectX} y={block.top - padding} width={estimatedWidth + padding * 2} height={height + padding * 2} rx={Math.min(primarySize, 8)} fill={lineColor} opacity=".92" data-aarc-line-name-carpet="true" />}
    {tag.kind === 'MapIcon' && icon?.url && <image href={icon.url} x={x - (icon.width ?? 50) / 2} y={y - (icon.width ?? 50) / 2} width={icon.width ?? 50} height={icon.width ?? 50} data-aarc-icon-id={icon.id} />}
    {tag.kind === 'MapIcon' && !icon?.url && !primaryLines.length && <circle cx={x} cy={y} r={Math.max(4, primarySize / 2)} fill={primaryColor} data-aarc-icon-fallback="true" />}
    {primaryLines.length > 0 && <text x={x} y={block.baseline} textAnchor={align} fontFamily={optionFont(tag)} fontSize={primarySize} fontWeight={optionWeight(tag, false, tag.kind === 'LineNameLabel')} fontStyle={primaryOption?.style} fill={primaryColor} data-aarc-text-primary="true">
      {primaryLines.map((value, index) => <tspan key={`p-${index}`} x={x} dy={index === 0 ? 0 : rowHeight}>{value}</tspan>)}
      {secondaryLines.map((value, index) => <tspan key={`s-${index}`} x={x} dy={index === 0 ? secondarySize * 1.2 + padding : secondaryAdvance} fontFamily={optionFont(tag, true)} fontSize={secondarySize} fontWeight={optionWeight(tag, true)} fontStyle={secondaryOption?.style} fill={secondaryColor}>{value}</tspan>)}
    </text>}
    {tag.dropCap && primaryLines[0] && <title>dropCap {tag.dropCapLength ?? 1}</title>}
  </g>
}

export const AarcTextTagsLayer = memo(function AarcTextTagsLayer({ project, presentation = false, visibleLineIds }: { project: ActualRouteProject; presentation?: boolean; visibleLineIds?: Set<string> }) {
  const tags = (project.textTags ?? [])
    .map((tag, index) => ({ tag, index }))
    .filter(({ tag }) => !tag.sunken && (!presentation || !tag.lineId || !visibleLineIds || visibleLineIds.has(tag.lineId)))
    .sort((a, b) => (a.tag.zIndex ?? 0) - (b.tag.zIndex ?? 0) || a.index - b.index)
    .map(({ tag }) => tag)
  if (!tags.length) return null
  return <g data-layer="aarc-text-tags" data-presentation-layer={presentation ? 'aarc-text-tags' : undefined} pointerEvents="none">{tags.map(tag => <Tag key={tag.id} tag={tag} project={project} presentation={presentation} />)}</g>
})
