import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { appendStationToLine, connectExistingStation, createBranchLine } from './operations'
import { getEffectiveLineColor } from './lineIdentity'
import { getPassengerStationCountForLine } from './passengerStats'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'
import { compilePresentation } from '../presentation/compiler'
import { PresentationScene } from '../presentation/PresentationScene'

describe('native branch line integration', () => {
  it('round-trips and presents an independently editable child line while reusing parent stations', () => {
    const seed = structuredClone(demoProject)
    const created = createBranchLine(seed, 'line-a', { name: '机场支线', openedAt: '2026-01-01' })
    expect(created.lineId).toBeTruthy()

    let project = connectExistingStation(created.project, created.lineId!, 's2')
    const branchOnly = appendStationToLine(project, created.lineId!, { x: 540, y: 650 }, 's2')
    project = branchOnly.project
    project = connectExistingStation(project, created.lineId!, 's4', branchOnly.stationId)

    const branch = project.lines.find(line => line.id === created.lineId)!
    expect(branch.parentLineId).toBe('line-a')
    expect(branch.stationSequence).toEqual(['s2', branchOnly.stationId, 's4'])
    expect(getEffectiveLineColor(project, branch)).toBe(getEffectiveLineColor(project, 'line-a'))
    expect(getPassengerStationCountForLine(project, branch.id)).toBe(3)
    expect(project.stations.filter(station => station.id === 's2')).toHaveLength(1)
    expect(project.stations.filter(station => station.id === 's4')).toHaveLength(1)

    const restored = parseProjectJson(serializeProject(project))
    const restoredBranch = restored.lines.find(line => line.id === branch.id)!
    expect(restoredBranch.parentLineId).toBe('line-a')
    expect(restoredBranch.stationSequence).toEqual(branch.stationSequence)
    expect(getEffectiveLineColor(restored, restoredBranch)).toBe(getEffectiveLineColor(restored, 'line-a'))
    expect(getPassengerStationCountForLine(restored, restoredBranch.id)).toBe(3)

    const sequence = compilePresentation(restored)
    const view = render(<PresentationScene project={restored} sequence={sequence} time={sequence.duration} width={1280} height={720} />)
    expect(view.container.querySelector('svg.presentation-scene')?.outerHTML).not.toMatch(/\bNaN\b|\bInfinity\b/)
    expect(view.container.querySelectorAll(`[data-line-id="${restoredBranch.id}"], [data-segment-id]`).length).toBeGreaterThan(0)
  })
})
