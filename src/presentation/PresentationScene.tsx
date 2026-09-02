import { memo, useMemo, type Ref } from 'react'
import type { ActualRouteProject, Line } from '../data/model'
import { getSegmentPath } from '../geometry/path'
import { getTransferMarkerRotation } from '../geometry/tangent'
import { SegmentArtwork, StructureRunArtwork } from '../renderer/segmentStyles'
import { compileElevatedRuns } from '../data/structure'
import { getStationStyle } from '../renderer/stationStyles'
import { StationLabel } from '../renderer/StationLabel'
import { MapElementsLayer } from '../renderer/MapElements'
import { LineBadgesLayer } from '../renderer/LineBadges'
import { effectiveLineWidth, effectiveStationStyle } from '../data/style'
import { getLineStyle, resolveLineStyle } from '../data/lineStyles'
import { getStationNameAt } from '../data/stationNameHistory'
import { getPresentationState } from './engine'
import type { PresentationSequence } from './types'

export const PresentationScene = memo(function PresentationScene({ project, sequence, time, width, height, svgRef }: { project: ActualRouteProject; sequence: PresentationSequence; time: number; width: number; height: number; svgRef?: Ref<SVGSVGElement> }) {
  const state = useMemo(() => getPresentationState(project, sequence, time), [project, sequence, time])
  const style = getStationStyle(project.settings.stationStyleId)
  const lineMap = useMemo(() => new Map(project.lines.map(line => [line.id, line])), [project.lines])
  const historicalProject = useMemo(() => ({ ...project, geometry: { ...project.geometry, segments: project.geometry.segments.map(segment => ({ ...segment, lineId: state.segmentStates[segment.id]?.lineId ?? segment.lineId })) } }), [project, state.segmentStates])
  const segmentArtwork = useMemo(() => project.geometry.segments.map(segment => { const lineId = state.segmentStates[segment.id]?.lineId ?? segment.lineId; const historicalSegment = historicalProject.geometry.segments.find(item => item.id === segment.id) ?? segment; return { segment, line: lineMap.get(lineId), path: getSegmentPath(historicalProject, historicalSegment) } }), [project, state.segmentStates, historicalProject, lineMap])
  const rotations = useMemo(() => new Map(project.stations.map(station => [station.id, getTransferMarkerRotation(project, station.id, state.historyDate)])), [project, state.historyDate])
  const elevatedRuns = useMemo(() => compileElevatedRuns(historicalProject, new Set(historicalProject.geometry.segments.filter(segment => lineMap.get(segment.lineId)?.visible).map(segment => segment.id)), Object.fromEntries(Object.entries(state.segmentStates).map(([id, value]) => [id, { revealProgress: value.revealProgress, revealFrom: value.revealFrom, opacity: value.opacity }]))), [historicalProject, lineMap, state.segmentStates])
  const visibleLineIds = new Set(segmentArtwork.filter(({ segment, line }) => line?.visible && (state.segmentStates[segment.id]?.revealProgress ?? 0) > 0).map(({ segment }) => state.segmentStates[segment.id]?.lineId ?? segment.lineId))
  const visibleLines = project.lines.filter(line => visibleLineIds.has(line.id))
  const findLines = (ids: string[]) => ids.map(id => lineMap.get(id)).filter((line): line is Line => Boolean(line))

  return <svg ref={svgRef} className="presentation-scene" xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`${state.camera.x} ${state.camera.y} ${state.camera.width} ${state.camera.height}`} preserveAspectRatio="xMidYMid slice" data-presentation-time={time.toFixed(3)} data-beat-id={state.currentBeat?.beatId ?? ''} data-global-reveal-progress={state.globalRevealProgress.toFixed(4)}>
    <rect x={state.camera.x} y={state.camera.y} width={state.camera.width} height={state.camera.height} fill="#f3f0e9" />
    {sequence.settings.showBackground && project.background?.visible && <image href={project.background.dataUrl} x={project.background.x} y={project.background.y} width={project.background.width} height={project.background.height} opacity={project.background.opacity} />}
    <g data-presentation-layer="segments">{segmentArtwork.map(({ segment, line, path }) => {
      const segmentState = state.segmentStates[segment.id]
      if (!line?.visible || !segmentState || segmentState.revealProgress <= 0 || segmentState.opacity <= 0) return null
      return <SegmentArtwork key={segment.id} segment={segment} line={line} path={path} lineWidth={effectiveLineWidth(line, project.settings)} revealProgress={segmentState.revealProgress} revealFrom={segmentState.revealFrom} opacity={segmentState.opacity} renderLegacyStructure={false} style={resolveLineStyle(project, line)} />
    })}</g>
    <g data-presentation-layer="structure-runs">{elevatedRuns.map(run => { const line = lineMap.get(run.lineId); return line ? <StructureRunArtwork key={run.id} run={run} line={line} lineWidth={effectiveLineWidth(line, project.settings)} style={getLineStyle(project, 'elevated')} /> : null })}</g>    <g data-presentation-layer="stations">{project.stations.map(station => {
      const stationState = state.stationStates[station.id]
      if (!stationState || stationState.opacity <= 0) return null
      const lines = findLines(stationState.lineIds), previousLines = findLines(stationState.previousLineIds), stationStyle = effectiveStationStyle(station, project.settings)
      return <g key={station.id} data-station-id={station.id} data-station-opacity={stationState.opacity.toFixed(4)} data-label-opacity={stationState.labelOpacity.toFixed(4)} data-transfer-progress={stationState.transferProgress.toFixed(4)} data-historical-state={stationState.historicalState} data-visible-line-ids={stationState.lineIds.join(',')} data-visible-relation-ids={stationState.visibleRelationIds.join(',')}>
        {style.renderPresentation({ station, lines, previousLines, size: stationStyle.stationSize, minorAxis: stationStyle.transferMinorAxis, dotGap: stationStyle.transferDotGap, endPadding: stationStyle.transferEndPadding, rotation: rotations.get(station.id) ?? 0, morphProgress: stationState.transferProgress, opacity: stationState.opacity, scale: stationState.scale })}
        {sequence.settings.showLabels && project.settings.labelsVisible && !station.labelHidden && <StationLabel station={station} settings={project.settings} showForeign={sequence.settings.showForeignStationNames && project.settings.showForeignStationNames} presentation opacity={stationState.labelOpacity} {...getStationNameAt(station,state.historyDate)} />}
      </g>
    })}</g>
    <LineBadgesLayer project={project} presentation visibleLineIds={visibleLineIds} />
    <MapElementsLayer project={project} presentation />
    {(() => { const beat=[...sequence.beats].reverse().find(item=>item.presentationStart<=time&&item.type!=='STATION_RENAME'&&item.type!=='LINE_REASSIGNMENT'&&!item.type.includes('CLOSURE'));if(!beat)return null;const line=lineMap.get(beat.lineId);if(!line)return null;const phase=beat.openingPhaseId?project.openingPhases.find(item=>item.id===beat.openingPhaseId):undefined;const x=state.camera.x+state.camera.width*.035,y=state.camera.y+state.camera.height*.045,w=state.camera.width*.23,h=phase?.name?state.camera.height*.105:state.camera.height*.07;return <g className="presentation-current-opening" data-current-line-id={line.id} data-current-phase-id={phase?.id??''}><rect x={x} y={y} width={w} height={h} rx={state.camera.height*.012} fill="#fffdf8" stroke="#d8d2c7" strokeWidth={state.camera.height*.002} opacity=".94"/><rect x={x+state.camera.width*.012} y={y+state.camera.height*.014} width={state.camera.height*.042} height={state.camera.height*.042} rx={state.camera.height*.008} fill={line.color}/><text x={x+state.camera.width*.033} y={y+state.camera.height*.044} textAnchor="middle" fill="#fff" fontSize={state.camera.height*.026} fontWeight="700">{line.name}</text><text x={x+state.camera.width*.064} y={y+state.camera.height*.044} fill="#252a27" fontSize={state.camera.height*.027} fontWeight="700">{line.name}</text>{phase?.name&&<text x={x+state.camera.width*.064} y={y+state.camera.height*.079} fill="#6a716c" fontSize={state.camera.height*.022}>{phase.name}</text>}</g> })()}
    {sequence.settings.title && <text x={state.camera.x + state.camera.width * .04} y={state.camera.y + state.camera.height * .08} className="presentation-title">{sequence.settings.title}</text>}
    {(sequence.settings.showOperatingLength || sequence.settings.showStationCount) && <g className="presentation-statistics" data-operating-length-km={state.statistics.operatingLengthKm.toFixed(3)} data-station-count={state.statistics.stationCount}>
      <rect x={state.camera.x + state.camera.width * .03} y={state.camera.y + state.camera.height * .79} width={state.camera.width * .39} height={state.camera.height * .17} rx={state.camera.height * .016} fill="#fffdf8" stroke="#d8d2c7" strokeWidth={state.camera.height * .002} opacity=".94" />
      <text x={state.camera.x + state.camera.width * .05} y={state.camera.y + state.camera.height * .835} fill="#5d625f" fontSize={Math.min(state.camera.height * .022, state.camera.width * .015)}>全网</text>
      {sequence.settings.showOperatingLength && <text x={state.camera.x + state.camera.width * .105} y={state.camera.y + state.camera.height * .835} fill="#202523" fontSize={Math.min(state.camera.height * .027, state.camera.width * .019)} fontWeight="700">运营里程 {state.statistics.operatingLengthKm.toFixed(1)} km</text>}
      {sequence.settings.showStationCount && <text x={state.camera.x + state.camera.width * .29} y={state.camera.y + state.camera.height * .835} fill="#202523" fontSize={Math.min(state.camera.height * .027, state.camera.width * .019)} fontWeight="700">车站 {state.statistics.stationCount} 座</text>}
      {state.lineStatistics.map((item, index) => { const line = lineMap.get(item.lineId); return line ? <g key={item.lineId} transform={`translate(${state.camera.x + state.camera.width * (.05 + (index % 2) * .18)} ${state.camera.y + state.camera.height * (.885 + Math.floor(index / 2) * .035)})`}><rect x="0" y={-state.camera.height * .018} width={state.camera.width * .014} height={state.camera.height * .024} rx={state.camera.height * .006} fill={line.color} /><text x={state.camera.width * .021} y="0" fill="#4d5350" fontSize={Math.min(state.camera.height * .019, state.camera.width * .013)}>{line.name} · {item.operatingLengthKm.toFixed(1)} km · {item.stationCount} 站</text></g> : null })}
    </g>}
    {sequence.settings.showDate && <g className="presentation-date"><rect x={state.camera.x + state.camera.width * .73} y={state.camera.y + state.camera.height * .865} width={state.camera.width * .235} height={state.camera.height * .095} rx={state.camera.height * .016} fill="#fffdf8" stroke="#d8d2c7" strokeWidth={state.camera.height * .002} opacity=".94" /><text x={state.camera.x + state.camera.width * .8475} y={state.camera.y + state.camera.height * .928} textAnchor="middle" fill="#202523" fontSize={Math.min(state.camera.height * .042, state.camera.width * .032)} fontWeight="700">{state.dateLabel}</text></g>}
    {sequence.settings.showLegend && <g className="presentation-legend">{visibleLines.map((line, index) => { const lineWidth=effectiveLineWidth(line, project.settings); return <g key={line.id} transform={`translate(${state.camera.x + state.camera.width * .04} ${state.camera.y + state.camera.height * (.84 + index * .035)})`}><line x1="0" x2={state.camera.width * .035} stroke={line.color} strokeWidth={lineWidth * .45} strokeLinecap="round" /><text x={state.camera.width * .045} y={lineWidth * .18} className="presentation-legend-label">{line.name}</text></g> })}</g>}
  </svg>
})
