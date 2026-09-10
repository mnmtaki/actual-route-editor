import { describe, expect, it } from 'vitest'
import rawChangling from './__fixtures__/常陵.aarc-9.json'
import rawPinglan from './__fixtures__/平岚.aarc (9).json'
import rawMinimal from './__fixtures__/测试.aarc (1).json'
import { convertAarcToActualRouteProject } from './aarc'
import { parseProjectJson, serializeProject } from './projectJson'
import { isValidAarcTerrainColor, parseAarcTerrainWidth, resolveAarcTerrainAppearance, resolveAarcTerrainPreset, resolveAarcTerrainSourceMetrics, resolveAarcTerrainWidth, AARC_TERRAIN_WORLD_WIDTH_PER_SOURCE_UNIT } from './aarcTerrain'

describe('AARC terrain calibration', () => {
  it('resolves known presets before raw colors', () => {
    expect(resolveAarcTerrainPreset(2)).toEqual({ category: 'water', color: '#C3E5EB' })
    expect(resolveAarcTerrainPreset('3')).toEqual({ category: 'terrain', color: '#CEEDA4' })
    expect(resolveAarcTerrainAppearance(2, '#000000').color).toBe('#C3E5EB')
    expect(resolveAarcTerrainAppearance(3, '#000000').color).toBe('#CEEDA4')
  })

  it('keeps valid custom colors and has stable fallbacks', () => {
    expect(resolveAarcTerrainAppearance(undefined, '#ABE81E')).toMatchObject({ category: 'other', color: '#ABE81E', usedRawColor: true })
    expect(resolveAarcTerrainAppearance('unknown', 'not-a-color').usedFallbackColor).toBe(true)
    expect(isValidAarcTerrainColor('#abcdef')).toBe(true)
    expect(isValidAarcTerrainColor('#abc')).toBe(false)
  })

  it('converts source width to world width and defaults missing width to one', () => {
    expect(AARC_TERRAIN_WORLD_WIDTH_PER_SOURCE_UNIT).toBeCloseTo(125 / 9, 10)
    expect(parseAarcTerrainWidth('9')).toEqual({ raw: 9, usedDefault: false })
    expect(parseAarcTerrainWidth(undefined)).toEqual({ raw: 1, usedDefault: true })
    expect(resolveAarcTerrainWidth('9')).toBeCloseTo(125, 8)
    expect(resolveAarcTerrainWidth(undefined)).toBeCloseTo(125 / 9, 8)
    expect(resolveAarcTerrainSourceMetrics(9)).toEqual({ widthRatio: 9, sourcePhysicalWidth: 126 })
    expect(resolveAarcTerrainSourceMetrics(12)).toEqual({ widthRatio: 12, sourcePhysicalWidth: 168 })
  })
})

describe('AARC type=1 terrain importer', () => {
  it('bypasses rail station and segment conversion and preserves raw point coordinates', () => {
    const raw = {
      cvsSize: [100, 100],
      points: [
        { id: 1, pos: [0, 0], sta: 0 },
        { id: 2, pos: [10, 0], sta: 0 },
        { id: 3, pos: [20, 0], sta: 1, name: 'terrain point' },
      ],
      lines: [
        { id: 10, name: 'R', type: 0, pts: [1, 2] },
        { id: 20, name: 'T', type: 1, pts: [1, 2, 3], colorPre: 2, color: '#000000', width: '9', zIndex: '4' },
      ],
    }
    const { project } = convertAarcToActualRouteProject(raw)
    expect(project.stations).toHaveLength(0)
    expect(project.geometry.segments).toHaveLength(0)
    expect(project.basemapPaths).toHaveLength(1)
    expect(project.basemapPaths?.[0]).toMatchObject({ category: 'water', color: '#C3E5EB', width: 125, closed: false, isFilled: false, zIndex: 4 })
    expect(project.basemapPaths?.[0]?.points.map(point => [point.x, point.y])).toEqual([[0, 0], [10, 0], [20, 0]])
  })

  it('preserves 平岚 terrain colors, widths, stacking and every source point', () => {
    const { project } = convertAarcToActualRouteProject(rawPinglan, '平岚.aarc (9).json')
    const sourcePoints = new Map((rawPinglan.points as unknown as Array<{ id: number; pos: [number, number] }>).map(point => [point.id, point.pos]))
    const sourceTerrain = (rawPinglan.lines as Array<{ id: number; name?: string; type?: number; pts: number[]; color?: string; colorPre?: number; width?: number; zIndex?: number; isFilled?: boolean }>).filter(line => line.type === 1)
    const paths = project.basemapPaths ?? []
    expect(paths).toHaveLength(3)
    for (const source of sourceTerrain) {
      const path = paths.find(item => item.source?.sourceLineId === source.id)!
      expect(path.points).toHaveLength(source.pts.length)
      expect(path.points.map(point => [point.x, point.y])).toEqual(source.pts.map(id => sourcePoints.get(id)))
      expect(path.width).toBeCloseTo((source.width ?? 1) * (125 / 9), 8)
    }
    expect(paths.find(path => path.source?.sourceLineId === 5)).toMatchObject({ name: '岚江', category: 'water', color: '#C3E5EB', width: 125, zIndex: 0, isFilled: false })
    expect(paths.find(path => path.source?.sourceLineId === 8)).toMatchObject({ name: '平河', category: 'water', color: '#C3E5EB', width: 125, zIndex: 1, isFilled: false })
    expect(paths.find(path => path.source?.sourceLineId === 57)).toMatchObject({ name: '里安山', category: 'other', color: '#ABE81E', zIndex: -1, isFilled: false }); expect(paths.find(path => path.source?.sourceLineId === 57)?.width).toBeCloseTo(125 * 12 / 9, 8)
  })

  it('imports colorPre=3 stroke and filled terrain without inferring fill from color or closure', () => {
    const { project } = convertAarcToActualRouteProject(rawMinimal, '测试.aarc (1).json')
    const paths = project.basemapPaths ?? []
    expect(paths).toHaveLength(2)
    expect(paths[0]).toMatchObject({ category: 'terrain', color: '#CEEDA4', width: 125 / 9, closed: false, isFilled: false, zIndex: 0 })
    expect(paths[1]).toMatchObject({ category: 'terrain', color: '#CEEDA4', width: 125 / 9, closed: true, isFilled: true, zIndex: 0 })
    expect(paths[1].points).toHaveLength(5)
  })

  it('applies the preset to 常陵 庆江 while preserving the source point count', () => {
    const { project } = convertAarcToActualRouteProject(rawChangling, '常陵.aarc-9.json')
    const source = (rawChangling.lines as Array<{ id: number; type?: number; pts: number[]; colorPre?: number; width?: number }>).find(line => line.id === 8)!
    const path = project.basemapPaths?.find(item => item.source?.sourceLineId === 8)!
    const points = new Map((rawChangling.points as unknown as Array<{ id: number; pos: [number, number] }>).map(point => [point.id, point.pos]))
    expect(path).toMatchObject({ color: '#C3E5EB', width: 125, closed: false, isFilled: false })
    expect(path.points).toHaveLength(source.pts.length)
    expect(path.points.map(point => [point.x, point.y])).toEqual(source.pts.map(id => points.get(id)))
  })

  it('round-trips imported terrain without losing effective fields or repeated terminal points', () => {
    const original = convertAarcToActualRouteProject(rawMinimal, '测试.aarc (1).json').project
    const restored = parseProjectJson(serializeProject(original))
    expect(restored.basemapPaths).toEqual(original.basemapPaths)
  })
})