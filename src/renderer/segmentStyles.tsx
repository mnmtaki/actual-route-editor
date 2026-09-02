import type { Line, LineStyle, Segment } from '../data/model'
import type { StructureRun } from '../data/structure'
import { BUILTIN_ELEVATED_STYLE_ID, BUILTIN_NORMAL_STYLE_ID, resolveLineStyleLayers } from '../data/lineStyles'

export const ELEVATED_STYLE = { outerWidthRatio: 1.38, separatorWidthRatio: 1.18, mainWidthRatio: 1, outerColorTarget: '#283033', outerColorMix: .55, separatorColorTarget: '#f7f4ec', separatorColorMix: .82 } as const
const PRESENTATION_PATH_LENGTH = 1000

export function getElevatedStrokeStyle(lineColor: string, lineWidth: number) { return { outerWidth: lineWidth * ELEVATED_STYLE.outerWidthRatio, separatorWidth: lineWidth * ELEVATED_STYLE.separatorWidthRatio, mainWidth: lineWidth * ELEVATED_STYLE.mainWidthRatio, outerColor: mixHex(lineColor, ELEVATED_STYLE.outerColorTarget, ELEVATED_STYLE.outerColorMix), separatorColor: mixHex(lineColor, ELEVATED_STYLE.separatorColorTarget, ELEVATED_STYLE.separatorColorMix), mainColor: lineColor } }

export function LineStyleArtwork({ style, line, path, lineWidth, revealProgress = 1, revealFrom = 'from', opacity = 1, className = 'segment-main' }: { style: LineStyle; line: Line; path: string; lineWidth: number; revealProgress?: number; revealFrom?: 'from' | 'to'; opacity?: number; className?: string }) {
  const reveal = Math.min(1, Math.max(0, revealProgress)), dashOffset = Number(((revealFrom === 'from' ? 1 : -1) * (1 - reveal) * PRESENTATION_PATH_LENGTH).toFixed(3))
  const common = { d: path, fill: 'none', pathLength: PRESENTATION_PATH_LENGTH, strokeDasharray: PRESENTATION_PATH_LENGTH + ' ' + PRESENTATION_PATH_LENGTH, strokeDashoffset: dashOffset, opacity }
  const layers = resolveLineStyleLayers(style, line.color, lineWidth)
  return <g data-line-style-id={style.id} data-line-style-layers={layers.length}>{layers.map((layer, index) => <path key={layer.id} {...common} className={index === layers.length - 1 ? className : 'line-style-layer line-style-layer-' + index} data-line-style-layer={layer.id} stroke={layer.resolvedColor} strokeWidth={layer.resolvedWidth} strokeOpacity={layer.resolvedOpacity} strokeLinecap={layer.lineCap ?? 'round'} strokeLinejoin={layer.lineJoin ?? 'round'} strokeDasharray={reveal >= 1 && layer.resolvedDash ? layer.resolvedDash : common.strokeDasharray} />)}</g>
}

export function SegmentArtwork({ segment, line, path, lineWidth, revealProgress = 1, revealFrom = 'from', opacity = 1, renderLegacyStructure = true, style }: { segment: Segment; line: Line; path: string; lineWidth: number; revealProgress?: number; revealFrom?: 'from' | 'to'; opacity?: number; renderLegacyStructure?: boolean; style?: LineStyle }) {
  if (renderLegacyStructure && segment.structureType === 'elevated' && (segment.structureNodes?.length ?? 0) === 0 && !style) {
    const legacy = getElevatedStrokeStyle(line.color, lineWidth), reveal = Math.min(1, Math.max(0, revealProgress)), dashOffset = Number(((revealFrom === 'from' ? 1 : -1) * (1 - reveal) * PRESENTATION_PATH_LENGTH).toFixed(3)), common = { d: path, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, pathLength: PRESENTATION_PATH_LENGTH, strokeDasharray: PRESENTATION_PATH_LENGTH + ' ' + PRESENTATION_PATH_LENGTH, strokeDashoffset: dashOffset, opacity }
    return <g data-segment-artwork="elevated" data-segment-id={segment.id} data-reveal-progress={reveal}><path {...common} className="segment-elevated-outer" stroke={legacy.outerColor} strokeWidth={legacy.outerWidth} /><path {...common} className="segment-elevated-separator" stroke={legacy.separatorColor} strokeWidth={legacy.separatorWidth} /><path {...common} className="segment-main" stroke={legacy.mainColor} strokeWidth={legacy.mainWidth} /></g>
  }
  const effectiveStyle = style ?? { id: BUILTIN_NORMAL_STYLE_ID, name: '普通', layers: [{ id: 'normal-main', colorMode: 'followLine' as const, width: 1, widthMode: 'ratio' as const }], builtin: true }, reveal = Math.min(1, Math.max(0, revealProgress)), dashOffset = Number(((revealFrom === 'from' ? 1 : -1) * (1 - reveal) * PRESENTATION_PATH_LENGTH).toFixed(3))
  return <g data-segment-artwork="base" data-segment-id={segment.id} data-reveal-progress={reveal} data-stroke-dashoffset={dashOffset}><LineStyleArtwork style={effectiveStyle} line={line} path={path} lineWidth={lineWidth} revealProgress={revealProgress} revealFrom={revealFrom} opacity={opacity} /></g>
}

export function StructureRunArtwork({ run, line, lineWidth, style }: { run: StructureRun; line: Line; lineWidth: number; style?: LineStyle }) {
  const fallbackStyle: LineStyle = { id: BUILTIN_ELEVATED_STYLE_ID, name: '高架', layers: [{ id: 'elevated-outer', colorMode: 'followLine', colorMixTarget: ELEVATED_STYLE.outerColorTarget, colorMixAmount: ELEVATED_STYLE.outerColorMix, width: ELEVATED_STYLE.outerWidthRatio, widthMode: 'ratio', lineCap: 'butt', lineJoin: 'round' }, { id: 'elevated-separator', colorMode: 'followLine', colorMixTarget: ELEVATED_STYLE.separatorColorTarget, colorMixAmount: ELEVATED_STYLE.separatorColorMix, width: ELEVATED_STYLE.separatorWidthRatio, widthMode: 'ratio', lineCap: 'butt', lineJoin: 'round' }, { id: 'elevated-main', colorMode: 'followLine', width: 1, widthMode: 'ratio', lineCap: 'butt', lineJoin: 'round' }], builtin: true }
  const layers = resolveLineStyleLayers(style ?? fallbackStyle, line.color, lineWidth), common = { d: run.path, fill: 'none', strokeLinecap: 'butt' as const, strokeLinejoin: 'round' as const }
  const getLayerClass = (index: number) => index === layers.length - 1 ? 'segment-main' : index === 0 ? 'segment-elevated-outer' : index === 1 ? 'segment-elevated-separator' : 'line-style-layer line-style-layer-' + index
  return <g data-structure-run-id={run.id} data-structure-type="elevated" data-run-segments={run.segmentIds.join(',')} data-start-boundary={run.startBoundary} data-end-boundary={run.endBoundary} opacity={run.opacity}>
    {layers.map((layer, index) => <g key={layer.id}><path {...common} data-run-centerline={index === layers.length - 1 ? 'main' : index === 0 ? 'outer' : index === 1 ? 'separator' : layer.id} className={getLayerClass(index)} data-line-style-layer={layer.id} stroke={layer.resolvedColor} strokeWidth={layer.resolvedWidth} strokeOpacity={layer.resolvedOpacity} strokeLinecap={layer.lineCap ?? 'butt'} strokeLinejoin={layer.lineJoin ?? 'round'} strokeDasharray={layer.resolvedDash} /><TerminalCaps run={run} radius={layer.resolvedWidth / 2} fill={layer.resolvedColor} layer={index === layers.length - 1 ? 'main' : index === 0 ? 'outer' : index === 1 ? 'separator' : layer.id} /></g>)}
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
