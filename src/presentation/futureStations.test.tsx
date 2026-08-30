import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import type { ActualRouteProject } from '../data/model'
import { isStationHistoricallyActive } from '../timeline/active'
import { inverseLineEasing } from './config'
import { compilePresentation } from './compiler'
import { getPresentationState } from './engine'
import { getStationArrivalRatio } from './reveal'
import { PresentationScene } from './PresentationScene'

function futureExtensionProject(): ActualRouteProject {
  const project = structuredClone(demoProject)
  const line = project.lines.find(item => item.id === 'line-a')!
  const names = ['新车站9', '新车站10', '新车站11', '新车站12', '新车站13']
  let previous = 's4'
  names.forEach((name, index) => {
    const id = `future-${9 + index}`
    project.stations.push({ id, name, x: 1040 + index * 250, y: 280 + index * 35, labelOffsetX: 14, labelOffsetY: -14, openedAt: '2026-01-01' })
    project.stationLineRelations.push({ id: `relation-${id}`, stationId: id, lineId: line.id, openedAt: '2026-01-01' })
    project.geometry.segments.push({ id: `extension-${index}`, lineId: line.id, fromStationId: previous, toStationId: id, mode: index % 2 ? 'smooth' : 'straight', structureType: index === 2 ? 'elevated' : 'underground', waypoints: index % 2 ? [{ id: `waypoint-${index}`, x: 920 + index * 250, y: 220 + index * 40, type: 'smooth' }] : [], openedAt: '2026-01-01' })
    line.stationSequence.push(id); previous = id
  })
  project.presentation = { ...project.presentation, startDate: '2000-01-01', endDate: '2026-01-01', cameraMode: 'follow' }
  return project
}

describe('future and current-partial station eligibility', () => {
  it('keeps 2026 stations entirely ineligible in 2020 and 2025', () => {
    const project = futureExtensionProject()
    for (const id of ['future-10', 'future-11', 'future-12', 'future-13']) {
      expect(isStationHistoricallyActive(project, id, '2020-01-01')).toBe(false)
      expect(isStationHistoricallyActive(project, id, '2025-12-31')).toBe(false)
    }
    const sequence = compilePresentation(project)
    const beat2020 = sequence.beats.find(beat => beat.historyDate === '2020-01-01')!
    const state = getPresentationState(project, sequence, beat2020.presentationEnd - .001)
    for (const id of ['future-10', 'future-11', 'future-12', 'future-13']) {
      expect(state.stationStates[id].historicalState).toBe('future')
      expect(state.stationStates[id].opacity).toBe(0)
      expect(state.stationStates[id].labelOpacity).toBe(0)
    }
  })

  it('reveals same-day extension stations one by one at their cumulative Geometry arrival distance', () => {
    const project = futureExtensionProject(), sequence = compilePresentation(project)
    const beat = sequence.beats.find(item => item.historyDate === '2026-01-01' && item.eventTypes.includes('SEGMENT_OPENING'))!
    const ids = ['future-9', 'future-10', 'future-11', 'future-12', 'future-13']
    for (let index = 0; index < ids.length; index += 1) {
      const ratio = getStationArrivalRatio(beat, ids[index])
      const arrivalTime = beat.revealStart + inverseLineEasing(ratio) * beat.revealDuration
      const before = getPresentationState(project, sequence, arrivalTime - .01)
      const after = getPresentationState(project, sequence, arrivalTime + .01)
      expect(before.stationStates[ids[index]].opacity).toBe(0)
      expect(before.stationStates[ids[index]].labelOpacity).toBe(0)
      expect(after.stationStates[ids[index]].opacity).toBeGreaterThan(0)
      expect(after.statistics.stationCount).toBe(before.statistics.stationCount + 1)
      for (const later of ids.slice(index + 1)) expect(before.stationStates[later].opacity).toBe(0)
    }
  })

  it('allows a genuine later station-only opening to fade in without a reveal front', () => {
    const project = structuredClone(demoProject)
    project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')!.openedAt = '2026-01-01'
    project.stations.find(item => item.id === 's3')!.openedAt = '2026-01-01'
    project.presentation.endDate = '2026-01-01'
    const sequence = compilePresentation(project), beat = sequence.beats.find(item => item.type === 'STATION_OPENING' && item.historyDate === '2026-01-01')!
    expect(beat.segmentIds).toHaveLength(0)
    expect(getPresentationState(project, sequence, beat.presentationStart).stationStates.s3.opacity).toBe(0)
    expect(getPresentationState(project, sequence, beat.revealStart + beat.revealDuration * .75).stationStates.s3.opacity).toBeGreaterThan(0)
  })

  it('omits future station marker and label nodes from the formal 2020 DOM and camera context', () => {
    const project = futureExtensionProject(), sequence = compilePresentation(project)
    const beat2020 = sequence.beats.find(beat => beat.historyDate === '2020-01-01')!
    const time = beat2020.presentationEnd - .001
    const state = getPresentationState(project, sequence, time)
    const { container } = render(<PresentationScene project={project} sequence={sequence} time={time} width={1920} height={1080} />)
    expect(container.querySelector('[data-station-id="future-10"]')).toBeNull()
    expect(container.textContent).not.toContain('新车站10')
    expect(state.camera.x + state.camera.width).toBeLessThan(project.stations.find(item => item.id === 'future-13')!.x)
  })
})