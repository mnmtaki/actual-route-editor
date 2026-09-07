import { describe, expect, it } from 'vitest'
import type { ActualRouteProject, Segment } from '../data/model'
import { DEFAULT_PRESENTATION_SETTINGS, DEFAULT_SETTINGS } from '../data/model'
import { compilePresentation } from './compiler'
import { getPresentationState } from './engine'
import { ORIGIN_HOLD_DURATION, ORIGIN_REVEAL_DURATION, getOpeningAnimationState } from './reveal'

const date = '2026-01-01'

function segment(id: string, fromStationId: string, toStationId: string, openedAt: string): Segment {
  return { id, lineId: 'line-new', fromStationId, toStationId, mode: 'straight', structureType: 'underground', structureNodes: [], waypoints: [], openedAt }
}

function newLineProject(): ActualRouteProject {
  return {
    version: 1,
    name: 'origin-prelude',
    stations: [
      { id: 'A', name: 'A', x: 0, y: 0, labelOffsetX: 10, labelOffsetY: -10 },
      { id: 'B', name: 'B', x: 100, y: 0, labelOffsetX: 10, labelOffsetY: -10 },
      { id: 'C', name: 'C', x: 200, y: 0, labelOffsetX: 10, labelOffsetY: -10 },
    ],
    lines: [{ id: 'line-new', name: '新线', color: '#c33', stationSequence: ['A', 'B', 'C'], lineOrder: 0, openedAt: date, visible: true, locked: false }],
    stationLineRelations: ['A', 'B', 'C'].map(stationId => ({ id: `r-${stationId}`, stationId, lineId: 'line-new', openedAt: date })),
    openingPhases: [],
    geometry: { segments: [segment('AB', 'A', 'B', date), segment('BC', 'B', 'C', date)] },
    background: null,
    timeline: { currentDate: date, startDate: date, endDate: date, playing: false },
    presentation: { ...DEFAULT_PRESENTATION_SETTINGS, startDate: date, endDate: date, growthSpeedKmPerSecond: 2, pauseDuration: 0, cameraMode: 'fixed' },
    settings: { ...DEFAULT_SETTINGS, worldUnitsPerKm: 100 },
  }
}

function extensionProject(): ActualRouteProject {
  const project = newLineProject()
  project.lines[0].openedAt = '2000-01-01'
  project.stationLineRelations.forEach(relation => { relation.openedAt = relation.stationId === 'C' ? date : '2000-01-01' })
  project.geometry.segments[0].openedAt = '2000-01-01'
  project.geometry.segments[1].openedAt = date
  project.presentation.startDate = '2000-01-01'
  return project
}

describe('opening origin station prelude', () => {
  it('fades a genuinely new origin before starting the unchanged line reveal', () => {
    const project = newLineProject(), sequence = compilePresentation(project), beat = sequence.beats[0]
    expect(beat.originStationId).toBe('A')
    expect(beat.needsOriginReveal).toBe(true)
    expect(beat.originRevealDuration).toBe(ORIGIN_REVEAL_DURATION)
    expect(beat.originHoldDuration).toBe(ORIGIN_HOLD_DURATION)
    expect(beat.revealStart - beat.originRevealStart).toBeCloseTo(ORIGIN_REVEAL_DURATION + ORIGIN_HOLD_DURATION, 10)

    const start = getPresentationState(project, sequence, beat.originRevealStart)
    expect(start.stationStates.A.opacity).toBe(0)
    expect(start.stationStates.A.scale).toBeCloseTo(.75, 10)
    expect(start.stationStates.A.labelOpacity).toBe(0)
    expect(start.segmentStates.AB.revealProgress).toBe(0)
    expect(start.stationStates.B.opacity).toBe(0)

    const middle = getPresentationState(project, sequence, beat.originRevealStart + .15)
    expect(middle.stationStates.A.opacity).toBeGreaterThan(0)
    expect(middle.stationStates.A.opacity).toBeLessThan(1)
    expect(middle.stationStates.A.scale).toBeGreaterThan(.75)
    expect(middle.stationStates.A.scale).toBeLessThan(1)
    expect(middle.segmentStates.AB.revealProgress).toBe(0)

    const hold = getPresentationState(project, sequence, beat.originRevealStart + ORIGIN_REVEAL_DURATION + .05)
    expect(hold.stationStates.A.opacity).toBe(1)
    expect(hold.stationStates.A.labelOpacity).toBe(1)
    expect(hold.segmentStates.AB.revealProgress).toBe(0)
    expect(getPresentationState(project, sequence, beat.revealStart + .01).segmentStates.AB.revealProgress).toBeGreaterThan(0)

    const timing = getOpeningAnimationState(beat, beat.originRevealStart + .15)
    expect(timing.originRevealProgress).toBeCloseTo(.5, 10)
    expect(timing.lineRevealProgress).toBe(0)
    expect(getOpeningAnimationState(beat, beat.originRevealStart + .15)).toEqual(timing)
  })

  it('skips the prelude when the directed origin is already part of the stable network', () => {
    const project = extensionProject(), sequence = compilePresentation(project), beat = sequence.beats.find(item => item.historyDate === date)!
    expect(beat.type).toBe('LINE_EXTENSION')
    expect(beat.originStationId).toBe('B')
    expect(beat.needsOriginReveal).toBe(false)
    expect(beat.originRevealDuration).toBe(0)
    expect(beat.revealStart).toBeCloseTo(beat.presentationStart + beat.cameraTransitionDuration, 10)
  })

  it('does not add an origin prelude to station-only openings', () => {
    const project = newLineProject()
    project.stationLineRelations[2].openedAt = '2027-01-01'
    project.stations[2].openedAt = '2027-01-01'
    project.presentation.endDate = '2027-01-01'
    const sequence = compilePresentation(project), beat = sequence.beats.find(item => item.type === 'STATION_OPENING')!
    expect(beat.segmentIds).toHaveLength(0)
    expect(beat.needsOriginReveal).toBe(false)
    expect(beat.originRevealDuration).toBe(0)
  })
})
