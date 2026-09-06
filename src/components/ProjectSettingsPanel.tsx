import { useEffect, useRef, useState } from 'react'
import type { ActualRouteProject } from '../data/model'
import { resolveMetersPerWorldUnit } from '../data/distance'
import { getProjectName, normalizeProjectName } from '../data/projectMetadata'

export function ProjectSettingsPanel({ project, onChange, onStartCalibration, embedded = false }: {
  project: ActualRouteProject
  onChange: (project: ActualRouteProject) => void
  onStartCalibration?: () => void
  embedded?: boolean
}) {
  const [nameDraft, setNameDraft] = useState(() => getProjectName(project))
  const [scaleDraft, setScaleDraft] = useState(() => String(resolveMetersPerWorldUnit(project)))
  const nameEditing = useRef(false)
  const scaleEditing = useRef(false)
  useEffect(() => {
    if (!nameEditing.current) setNameDraft(getProjectName(project))
    if (!scaleEditing.current) setScaleDraft(String(Number(resolveMetersPerWorldUnit(project).toFixed(6))))
  }, [project.projectName, project.name, project.distanceScale?.metersPerWorldUnit, project.settings.worldUnitsPerKm])
  const commitName = () => {
    if (!nameEditing.current) return
    nameEditing.current = false
    const value = normalizeProjectName(nameDraft)
    if (value === getProjectName(project)) return
    const next = structuredClone(project)
    next.projectName = value
    next.name = value
    onChange(next)
  }
  const commitScale = () => {
    if (!scaleEditing.current) return
    scaleEditing.current = false
    const value = Number(scaleDraft)
    if (!Number.isFinite(value) || value <= 0 || Math.abs(value - resolveMetersPerWorldUnit(project)) < 1e-9) {
      setScaleDraft(String(Number(resolveMetersPerWorldUnit(project).toFixed(6))))
      return
    }
    const next = structuredClone(project)
    next.distanceScale = { metersPerWorldUnit: value }
    next.settings.worldUnitsPerKm = 1000 / value
    onChange(next)
  }
  return <section className={`project-settings-panel${embedded ? ' project-settings-panel-embedded' : ''}`} aria-label="工程设置">
    <div className="project-settings-group">
      <h3>工程</h3>
      <label className="field"><span>工程名称</span><input value={nameDraft} onFocus={() => { nameEditing.current = true }} onChange={event => setNameDraft(event.currentTarget.value)} onBlur={commitName} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitName(); event.currentTarget.blur() } }} /></label>
      <p className="project-settings-help">用于工程文件名，不会自动绘制到地图上。</p>
    </div>
    <div className="project-settings-group">
      <h3>距离比例</h3>
      <label className="field"><span>1 坐标单位 =</span><div className="project-distance-input"><input aria-label="每坐标单位米数" type="number" inputMode="decimal" min="0.000001" step="0.1" value={scaleDraft} onFocus={() => { scaleEditing.current = true }} onChange={event => setScaleDraft(event.currentTarget.value)} onBlur={commitScale} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitScale(); event.currentTarget.blur() } }} /><span>米</span></div></label>
      <p className="project-settings-help">只改变真实距离换算，不会移动坐标或改变线路形状。</p>
      <div className="project-settings-actions"><button type="button" className="active">手动设置</button><button type="button" onClick={onStartCalibration} disabled={!onStartCalibration}>两点标定</button></div>
    </div>
  </section>
}
