import { describe, expect, it } from 'vitest'
import { appendBasemapPoint, createBasemapPath, getBasemapPathD, insertBasemapPoint, normalizeBasemapPaths, sortedBasemapPaths } from './basemapPaths'
import { createEmptyProject } from './storage'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

describe('BasemapPath model helpers', () => {
  it('normalizes optional fields and removes repeated closed endpoint', () => {
    const paths = normalizeBasemapPaths([{ id: 'p', points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'a2', x: 0, y: 0 }], color: '#123456', width: '9', isFilled: true }])!
    expect(paths[0]).toMatchObject({ closed: true, isFilled: true, zIndex: 0, width: 9 })
    expect(paths[0].points).toHaveLength(2)
    expect(getBasemapPathD(paths[0])).toBe('M 0 0 L 10 0 Z')
  })

  it('starts native drawing empty and renders added nodes smoothly', () => {
    const project = createEmptyProject()
    const created = createBasemapPath(project, 'terrain', { x: 999, y: 999 })
    expect(created.project.basemapPaths?.[0].points).toHaveLength(0)
    let next = appendBasemapPoint(created.project, created.pathId, { x: 10, y: 20 })
    next = appendBasemapPoint(next, created.pathId, { x: 90, y: 40 })
    next = appendBasemapPoint(next, created.pathId, { x: 160, y: 120 })
    const path = next.basemapPaths?.[0]
    expect(path?.points.map(point => [point.x, point.y])).toEqual([[10, 20], [90, 40], [160, 120]])
    expect(getBasemapPathD(path!)).toContain(' C ')
  })

  it('keeps stable z ordering and supports point/path editing', () => {
    const project = createEmptyProject()
    const created = createBasemapPath(project, 'water')
    let next = appendBasemapPoint(created.project, created.pathId, { x: 1, y: 2 })
    next = appendBasemapPoint(next, created.pathId, { x: 11, y: 2 })
    next = insertBasemapPoint(next, created.pathId, { x: 6, y: 2 })
    expect(next.basemapPaths?.[0].points).toHaveLength(3)
    const paths = next.basemapPaths!
    paths.push({ ...paths[0], id: 'top', zIndex: 2 }, { ...paths[0], id: 'bottom', zIndex: -1 })
    expect(sortedBasemapPaths(paths).map(path => path.id).slice(-2)).toEqual([paths[0].id, 'top'])
  })

  it('round-trips basemap paths while leaving old projects compatible', () => {
    const project = createEmptyProject(), created = createBasemapPath(project, 'terrain')
    const restored = parseProjectJson(serializeProject(created.project))
    expect(restored.basemapPaths).toEqual(created.project.basemapPaths)
    const legacy = structuredClone(created.project)
    delete legacy.basemapPaths
    expect(parseProjectJson(serializeProject(legacy)).basemapPaths).toBeUndefined()
  })
})
