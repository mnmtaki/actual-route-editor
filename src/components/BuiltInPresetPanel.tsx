import { useMemo, useState } from 'react'
import type { ActualRouteProject, Line, Station } from '../data/model'
import { demoProject } from '../data/demo'
import { getBuiltInPresets, isPresetCompatible, presetCompatibilityMessage, applyPresetToStations, copyPresetToCustom, setDefaultPreset } from '../data/presetRegistry'
import { setProjectDefaultStationStyle } from '../data/stationStyles'
import { setProjectDefaultTransferStyle } from '../data/transferStyles'
import { getCompoundStationMembers } from '../data/compoundStation'
import { collapseLinesByServiceFamily, lineWithEffectiveColor } from '../data/lineIdentity'
import { sortTransferLinesForSpatialOrder } from '../geometry/transferOrdering'
import { resolveSideMarkerPlacement } from '../geometry/sideMarker'
import { StationArtwork } from '../renderer/stationStyles'
import { getLineDisplayCode, getStationCodeForLine, renderTransferArtwork } from '../renderer/transferArtwork'
import { effectiveLineWidth } from '../data/style'

const stationPreview: Station = { id: 'preset-preview-station', name: '预览', x: 0, y: 0, labelOffsetX: 0, labelOffsetY: 0 }
const previewLines: Line[] = [
  { id: 'preset-preview-line-1', name: '1号线', number: '1', color: '#df4e45', stationSequence: [stationPreview.id], lineOrder: 0, visible: true, locked: false },
  { id: 'preset-preview-line-2', name: '2号线', number: '2', color: '#3c78c8', stationSequence: [stationPreview.id], lineOrder: 1, visible: true, locked: false },
  { id: 'preset-preview-line-3', name: '3号线', number: '3', color: '#17a673', stationSequence: [stationPreview.id], lineOrder: 2, visible: true, locked: false },
  { id: 'preset-preview-line-4', name: '7号线', number: '7', color: '#8a5ab7', stationSequence: [stationPreview.id], lineOrder: 3, visible: true, locked: false },
  { id: 'preset-preview-line-5', name: '8号线', number: '8', color: '#d58a34', stationSequence: [stationPreview.id], lineOrder: 4, visible: true, locked: false },
  { id: 'preset-preview-line-6', name: '10号线', number: '10', color: '#377f77', stationSequence: [stationPreview.id], lineOrder: 5, visible: true, locked: false },
]

function previewProject(project: ActualRouteProject, count: number): ActualRouteProject {
  const lines = previewLines.slice(0, Math.max(1, Math.min(previewLines.length, count)))
  const stations = [{ ...stationPreview, compoundGroupId: lines.length > 1 ? 'preset-preview-compound' : undefined }]
  const anchors = count === 2 ? [Math.PI, 0] : Array.from({ length: lines.length }, (_, index) => -Math.PI / 2 + index * 2 * Math.PI / Math.max(1, lines.length))
  return { ...project, stations, lines, stationLineRelations: lines.map((line, index) => ({ id: `preset-preview-relation-${index}`, stationId: stationPreview.id, lineId: line.id, stationCode: String(index + 1).padStart(2, '0'), openedAt: '2000-01-01', anchor: { x: Math.cos(anchors[index] ?? 0) * 48, y: Math.sin(anchors[index] ?? 0) * 48 } })) }
}

export function PresetPreview({ project, presetId, serviceCount }: { project: ActualRouteProject; presetId: string; serviceCount?: number }) {
  const preset = getBuiltInPresets().find(item => item.id === presetId)
  if (!preset) return null
  if (preset.applicableType === 'station' && preset.stationStyle) {
    const sampleProject = previewProject(project, 1)
    const line = sampleProject.lines[0]
    const placement = preset.stationStyle.template === 'sideMarker' || preset.stationStyle.placement === 'side'
      ? resolveSideMarkerPlacement(sampleProject, stationPreview.id, line.id, { placementMode: preset.stationStyle.sidePlacementMode ?? 'outward', depthRatio: preset.stationStyle.sideDepthRatio, thicknessRatio: preset.stationStyle.sideThicknessRatio, preferredSide: preset.stationStyle.preferredSide })
      : undefined
    const lineWidth = effectiveLineWidth(line, sampleProject.settings)
    return <svg className="preset-preview-svg" viewBox="-70 -45 140 90" role="img" aria-label={`${preset.displayName}预览`}><line x1="-70" y1="0" x2="70" y2="0" stroke={line.color} strokeWidth={lineWidth} strokeLinecap="round" /><StationArtwork station={stationPreview} style={preset.stationStyle} lineColor={line.color} centerX={placement?.x} centerY={placement?.y} lineCode={getLineDisplayCode(line)} stationCode="01" sideMarker={placement} /></svg>
  }
  if (!preset.transferStyle) return null
  const count = serviceCount ?? preset.preview.serviceCount ?? preset.compatibility.recommendedServiceCount ?? preset.compatibility.minServiceCount
  const sampleProject = previewProject(project, count)
  const lines = sortTransferLinesForSpatialOrder(sampleProject, stationPreview.id, collapseLinesByServiceFamily(sampleProject, sampleProject.lines.map(line => lineWithEffectiveColor(sampleProject, line))), '2099-01-01')
  const viewBox = preset.transferStyle.template === 'kunming' ? (count === 2 ? '-70 -48 140 96' : '-65 -65 130 130') : '-100 -75 200 150'
  return <svg className="preset-preview-svg" viewBox={viewBox} role="img" aria-label={`${preset.displayName}预览`}><line x1="-100" y1="0" x2="100" y2="0" stroke="#d7d1c7" strokeWidth="3" />{renderTransferArtwork({ project: sampleProject, station: stationPreview, lines, style: preset.transferStyle, size: 16, minorAxis: 20, dotGap: 5, endPadding: 8, centerX: 0, centerY: 0, minMajorAxis: 0 })}</svg>
}

export function BuiltInPresetPanel({ project, onChange, selectedStationIds = [] }: { project: ActualRouteProject; onChange: (project: ActualRouteProject) => void; selectedStationIds?: string[] }) {
  const [error, setError] = useState<string | null>(null)
  const [previewCounts, setPreviewCounts] = useState<Record<string, number>>({})
  const groups = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getBuiltInPresets>>()
    for (const preset of getBuiltInPresets()) map.set(preset.category, [...(map.get(preset.category) ?? []), preset])
    return [...map.entries()]
  }, [])
  const apply = (presetId: string) => {
    const preset = getBuiltInPresets().find(item => item.id === presetId)
    if (!preset) return
    if (preset.applicableType === 'transfer' && selectedStationIds.length) {
      const logicalIds = new Set(project.stations.filter(station => selectedStationIds.includes(station.id)).flatMap(station => getCompoundStationMembers(project, station).map(member => member.id)))
      const counts = [...new Set(project.stations.filter(station => logicalIds.has(station.id)).map(station => collapseLinesByServiceFamily(project, project.stationLineRelations.filter(relation => getCompoundStationMembers(project, station).some(member => member.id === relation.stationId)).map(relation => project.lines.find(line => line.id === relation.lineId)).filter((line): line is Line => Boolean(line))).length))]
      const incompatible = counts.find(count => !isPresetCompatible(preset, count))
      if (incompatible !== undefined) { setError(presetCompatibilityMessage(preset, incompatible)); return }
      setError(null); onChange(applyPresetToStations(project, selectedStationIds, presetId)); return
    }
    setError(null)
    onChange(selectedStationIds.length && preset.applicableType === 'station' ? applyPresetToStations(project, selectedStationIds, presetId) : setDefaultPreset(project, preset.applicableType, presetId))
  }
  const copy = (presetId: string) => {
    const result = copyPresetToCustom(project, presetId)
    if (!result.styleId) return
    const preset = getBuiltInPresets().find(item => item.id === presetId)
    const next = preset?.applicableType === 'station' ? setProjectDefaultStationStyle(result.project, result.styleId) : setProjectDefaultTransferStyle(result.project, result.styleId)
    setError(null); onChange(next)
  }
  return <div className="builtin-preset-panel" data-testid="builtin-preset-panel">
    {error && <p className="preset-error" role="alert">{error}</p>}
    {groups.map(([category, presets]) => <section className="preset-group" key={category} data-preset-category={category}>
      <h3>{category}</h3>
      <div className="preset-grid">{presets.map(preset => <article className="preset-card" key={preset.id} data-testid={`preset-card-${preset.id}`} data-preset-type={preset.applicableType}>
        <h4>{preset.displayName}</h4>
        {preset.id === 'transfer.guangzhou.classic' || preset.id === 'transfer.guangzhou.2024' || preset.id === 'transfer.kunming' ? <div className="preset-preview-counts" role="group" aria-label="预览线路数">{[2, 3, 4].map(count => <button key={count} type="button" aria-pressed={(previewCounts[preset.id] ?? preset.preview.serviceCount) === count} onClick={() => setPreviewCounts(current => ({ ...current, [preset.id]: count }))}>{count}线</button>)}</div> : null}
        <PresetPreview project={project} presetId={preset.id} serviceCount={previewCounts[preset.id]} />
        <p className="meta-note">{preset.applicableType === 'station' ? '普通站' : '换乘站'}{preset.compatibility.recommendedServiceCount ? ` · 推荐 ${preset.compatibility.recommendedServiceCount} 线` : ''}{preset.compatibility.maxServiceCount ? ` · 适用于 ${preset.compatibility.minServiceCount}–${preset.compatibility.maxServiceCount} 线` : ''}</p>
        <div className="preset-actions"><button type="button" onClick={() => apply(preset.id)}>应用</button><button type="button" onClick={() => copy(preset.id)}>复制为自定义样式</button></div>
      </article>)}</div>
    </section>)}
  </div>
}
