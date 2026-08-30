import type { Line, Segment } from '../data/model'
import type { StructureRun } from '../data/structure'

export const ELEVATED_STYLE = { outerWidthRatio: 1.38, separatorWidthRatio: 1.18, mainWidthRatio: 1, outerColorTarget: '#283033', outerColorMix: .55, separatorColorTarget: '#f7f4ec', separatorColorMix: .82 } as const
const PRESENTATION_PATH_LENGTH = 1000

export function getElevatedStrokeStyle(lineColor: string, lineWidth: number) { return { outerWidth: lineWidth * ELEVATED_STYLE.outerWidthRatio, separatorWidth: lineWidth * ELEVATED_STYLE.separatorWidthRatio, mainWidth: lineWidth * ELEVATED_STYLE.mainWidthRatio, outerColor: mixHex(lineColor, ELEVATED_STYLE.outerColorTarget, ELEVATED_STYLE.outerColorMix), separatorColor: mixHex(lineColor, ELEVATED_STYLE.separatorColorTarget, ELEVATED_STYLE.separatorColorMix), mainColor: lineColor } }

export function SegmentArtwork({ segment, line, path, lineWidth, revealProgress = 1, revealFrom = 'from', opacity = 1, renderLegacyStructure = true }: { segment: Segment; line: Line; path: string; lineWidth: number; revealProgress?: number; revealFrom?: 'from' | 'to'; opacity?: number; renderLegacyStructure?: boolean }) {
  const reveal = Math.min(1, Math.max(0, revealProgress)), dashOffset = Number(((revealFrom === 'from' ? 1 : -1) * (1 - reveal) * PRESENTATION_PATH_LENGTH).toFixed(3))
  const common = { d: path, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, pathLength: PRESENTATION_PATH_LENGTH, strokeDasharray: `${PRESENTATION_PATH_LENGTH} ${PRESENTATION_PATH_LENGTH}`, strokeDashoffset: dashOffset, opacity }
  const groupProps = { 'data-segment-id': segment.id, 'data-reveal-progress': reveal, 'data-stroke-dashoffset': dashOffset }
  if (!renderLegacyStructure || segment.structureType !== 'elevated' || (segment.structureNodes?.length ?? 0) > 0) return <g data-segment-artwork="base" {...groupProps}><path {...common} className="segment-main" stroke={line.color} strokeWidth={lineWidth} /></g>
  const style = getElevatedStrokeStyle(line.color, lineWidth)
  return <g data-segment-artwork="elevated" {...groupProps}><path {...common} className="segment-elevated-outer" stroke={style.outerColor} strokeWidth={style.outerWidth} /><path {...common} className="segment-elevated-separator" stroke={style.separatorColor} strokeWidth={style.separatorWidth} /><path {...common} className="segment-main" stroke={style.mainColor} strokeWidth={style.mainWidth} /></g>
}

export function StructureRunArtwork({ run, line, lineWidth }: { run: StructureRun; line: Line; lineWidth: number }) {
  const style = getElevatedStrokeStyle(line.color, lineWidth), common = { d: run.path, fill: 'none', strokeLinecap: 'butt' as const, strokeLinejoin: 'round' as const }
  return <g data-structure-run-id={run.id} data-structure-type="elevated" data-run-segments={run.segmentIds.join(',')} data-start-boundary={run.startBoundary} data-end-boundary={run.endBoundary} opacity={run.opacity}>
    <path {...common} data-run-centerline="outer" className="segment-elevated-outer" stroke={style.outerColor} strokeWidth={style.outerWidth} /><TerminalCaps run={run} radius={style.outerWidth / 2} fill={style.outerColor} layer="outer" />
    <path {...common} data-run-centerline="separator" className="segment-elevated-separator" stroke={style.separatorColor} strokeWidth={style.separatorWidth} /><TerminalCaps run={run} radius={style.separatorWidth / 2} fill={style.separatorColor} layer="separator" />
    <path {...common} data-run-centerline="main" className="segment-main" stroke={style.mainColor} strokeWidth={style.mainWidth} /><TerminalCaps run={run} radius={style.mainWidth / 2} fill={style.mainColor} layer="main" />
  </g>
}
function TerminalCaps({ run, radius, fill, layer }: { run: StructureRun; radius: number; fill: string; layer: string }) {
  const start = run.spans[0]?.start, end = run.spans.at(-1)?.end
  return <>
    {run.startBoundary === 'line-terminal' && start && <path data-terminal-cap="start" data-terminal-layer={layer} d={halfCapPath(radius)} fill={fill} transform={`translate(${start.x} ${start.y}) rotate(${angle(run.startTangent) + 180})`} />}
    {run.endBoundary === 'line-terminal' && end && <path data-terminal-cap="end" data-terminal-layer={layer} d={halfCapPath(radius)} fill={fill} transform={`translate(${end.x} ${end.y}) rotate(${angle(run.endTangent)})`} />}
  </>
}
function halfCapPath(radius: number) { return `M 0 ${-radius} A ${radius} ${radius} 0 0 1 0 ${radius} L 0 ${-radius} Z` }
function angle(value: { x: number; y: number }) { return Math.atan2(value.y, value.x) * 180 / Math.PI }
function mixHex(source: string, target: string, amount: number) { const a = parseHex(source) ?? parseHex('#555555')!, b = parseHex(target)!; const channel = (from: number, to: number) => Math.round(from + (to - from) * amount).toString(16).padStart(2, '0'); return `#${channel(a[0], b[0])}${channel(a[1], b[1])}${channel(a[2], b[2])}` }
function parseHex(value: string): [number, number, number] | null { const match = /^#([0-9a-f]{6})$/i.exec(value); return match ? [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16)] : null }