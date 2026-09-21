import { describe, expect, it } from 'vitest'
import rawChangling from './__fixtures__/常陵.aarc-9.json'
import rawPinglan from './__fixtures__/平岚.aarc (9).json'
import rawTongzhou from './__fixtures__/桐洲地铁未来规划.aarc.json'
import rawMinimal from './__fixtures__/测试.aarc (1).json'
import { convertAarcToActualRouteProject } from './aarc'
import { parseProjectJson, serializeProject } from './projectJson'
import { isValidAarcTerrainColor, parseAarcTerrainWidth, resolveAarcTerrainAppearance, resolveAarcTerrainPreset, resolveAarcTerrainSourceMetrics } from './aarcTerrain'
import { getBasemapPathD } from '../data/basemapPaths'
import { formalizeAarcBasemapPoints } from '../data/aarcBasemapGeometry'
import { reconstructAarcLineGeometry } from './aarcGeometry'

describe('AARC terrain calibration', () => {
  it('resolves all AARC terrain presets before raw colors', () => {
    expect(resolveAarcTerrainPreset(1)).toEqual({ category: 'other', color: '#CCCCCC' })
    expect(resolveAarcTerrainPreset(2)).toEqual({ category: 'water', color: '#C3E5EB' })
    expect(resolveAarcTerrainPreset('3')).toEqual({ category: 'terrain', color: '#CEEDA4' })
    expect(resolveAarcTerrainPreset(4)).toEqual({ category: 'other', color: '#FFFFFF' })
    expect(resolveAarcTerrainAppearance(1, '#000000').color).toBe('#CCCCCC')
    expect(resolveAarcTerrainAppearance(2, '#000000').color).toBe('#C3E5EB')
    expect(resolveAarcTerrainAppearance(3, '#000000').color).toBe('#CEEDA4')
    expect(resolveAarcTerrainAppearance(4, '#000000').color).toBe('#FFFFFF')
  })

  it('uses project-level AARC preset colors before defaults', () => {
    const config = {
      colorPresetArea: '#112233',
      colorPresetWater: '#224466',
      colorPresetGreenland: '#336699',
      colorPresetIsland: '#fefefe',
    }
    expect(resolveAarcTerrainAppearance(1, '#000000', config).color).toBe('#112233')
    expect(resolveAarcTerrainAppearance(2, '#000000', config).color).toBe('#224466')
    expect(resolveAarcTerrainAppearance(3, '#000000', config).color).toBe('#336699')
    expect(resolveAarcTerrainAppearance(4, '#000000', config).color).toBe('#fefefe')
  })

  it('keeps valid custom colors and has stable fallbacks', () => {
    expect(resolveAarcTerrainAppearance(undefined, '#ABE81E')).toMatchObject({ category: 'other', color: '#ABE81E', usedRawColor: true })
    expect(resolveAarcTerrainAppearance('unknown', 'not-a-color').usedFallbackColor).toBe(true)
    expect(isValidAarcTerrainColor('#abcdef')).toBe(true)
    expect(isValidAarcTerrainColor('#abc')).toBe(false)
  })

  it('resolves source semantic width using normalized config.lineWidth', () => {
    expect(parseAarcTerrainWidth('9')).toEqual({ raw: 9, usedDefault: false })
    expect(parseAarcTerrainWidth(undefined)).toEqual({ raw: 1, usedDefault: true })
    expect(resolveAarcTerrainSourceMetrics(9, 14)).toEqual({ widthRatio: 9, sourcePhysicalWidth: 126 })
    expect(resolveAarcTerrainSourceMetrics('9', 14)).toEqual({ widthRatio: 9, sourcePhysicalWidth: 126 })
    expect(resolveAarcTerrainSourceMetrics(12, 14)).toEqual({ widthRatio: 12, sourcePhysicalWidth: 168 })
    expect(resolveAarcTerrainSourceMetrics(undefined, 14)).toEqual({ widthRatio: 1, sourcePhysicalWidth: 14 })
    expect(resolveAarcTerrainSourceMetrics(2, 10)).toEqual({ widthRatio: 2, sourcePhysicalWidth: 20 })
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
    expect(project.basemapPaths?.[0]).toMatchObject({ category: 'water', color: '#C3E5EB', width: 126, closed: false, isFilled: false, zIndex: 4 })
    expect(project.basemapPaths?.[0]?.points.map(point => [point.x, point.y])).toEqual([[0, 0], [10, 0], [20, 0]])
  })

  it('preserves AARC dir/free semantics and reconstructs implicit terrain geometry', () => {
    const raw = {
      cvsSize: [100, 100],
      config: { lineWidth: 10, lineTurnAreaRadius: 30, lineCarpetWiden: 6, bgColor: '#f5f5f5' },
      points: [
        { id: 1, pos: [0, 0], sta: 0, dir: 0 },
        { id: 2, pos: [20, 10], sta: 0, dir: 0 },
      ],
      lines: [{ id: 20, name: 'T', type: 1, pts: [1, 2], width: 1, color: '#123456', cap: 'butt' }],
    }
    const { project } = convertAarcToActualRouteProject(raw)
    const path = project.basemapPaths![0]
    expect(path.points).toMatchObject([
      { aarcPointId: 1, aarcDir: 0 },
      { aarcPointId: 2, aarcDir: 0 },
    ])
    expect(path.geometry).toEqual({ kind: 'aarc', lineTurnAreaRadius: 30, lineWidthBase: 10, lineCarpetWiden: 6, backgroundColor: '#f5f5f5' })
    expect(path.lineCap).toBe('butt')
    expect(formalizeAarcBasemapPoints(path.points).map(point => [point.x, point.y])).toEqual([[0, 0], [5, 0], [15, 10], [20, 10]])
    expect(getBasemapPathD(path)).toContain(' A ')
    expect(getBasemapPathD(path)).not.toBe('M 0 0 L 20 10')
  })

  it('keeps free-point terrain legs direct while retaining arbitrary-angle rounding', () => {
    const raw = {
      cvsSize: [120, 120],
      points: [
        { id: 1, pos: [0, 0], sta: 0, dir: 0 },
        { id: 2, pos: [23, 17], sta: 0, dir: 1, free: true },
        { id: 3, pos: [80, 17], sta: 0, dir: 0 },
      ],
      lines: [{ id: 20, name: 'free terrain', type: 1, pts: [1, 2, 3], width: 1, color: '#123456' }],
    }
    const path = convertAarcToActualRouteProject(raw).project.basemapPaths![0]
    expect(path.points[1]).toMatchObject({ aarcPointId: 2, aarcDir: 1, aarcFree: true })
    expect(formalizeAarcBasemapPoints(path.points).map(point => [point.x, point.y])).toEqual([[0, 0], [23, 17], [80, 17]])
    expect(getBasemapPathD(path)).toContain(' A ')
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
      expect(path.width).toBeCloseTo(Number(source.width ?? 1) * 14, 8)
      expect(path.source?.sourceWidthRatio).toBeCloseTo(Number(source.width ?? 1), 8)
      expect(path.source?.sourcePhysicalWidth).toBeCloseTo(path.width, 8)
    }
    expect(paths.find(path => path.source?.sourceLineId === 5)).toMatchObject({ name: '岚江', category: 'water', color: '#C3E5EB', width: 126, zIndex: 0, isFilled: false })
    expect(paths.find(path => path.source?.sourceLineId === 8)).toMatchObject({ name: '平河', category: 'water', color: '#C3E5EB', width: 126, zIndex: 1, isFilled: false })
    expect(paths.find(path => path.source?.sourceLineId === 57)).toMatchObject({ name: '里安山', category: 'other', color: '#ABE81E', zIndex: -1, isFilled: false }); expect(paths.find(path => path.source?.sourceLineId === 57)?.width).toBeCloseTo(168, 8)
  })

  it('imports colorPre=3 stroke and filled terrain without inferring fill from color or closure', () => {
    const { project } = convertAarcToActualRouteProject(rawMinimal, '测试.aarc (1).json')
    const paths = project.basemapPaths ?? []
    expect(paths).toHaveLength(2)
    expect(paths[0]).toMatchObject({ category: 'terrain', color: '#CEEDA4', width: 14, closed: false, isFilled: false, zIndex: 0 })
    expect(paths[1]).toMatchObject({ category: 'terrain', color: '#CEEDA4', width: 14, closed: true, isFilled: true, zIndex: 0 })
    expect(paths[1].points).toHaveLength(5)
  })

  it('applies colorPre=1 area preset to the real 桐洲 terrain instead of raw black', () => {
    const { project } = convertAarcToActualRouteProject(rawTongzhou, '桐洲地铁未来规划.aarc.json')
    const path = project.basemapPaths?.find(item => item.source?.sourceLineId === 226)
    expect(path).toMatchObject({ name: '桐洲全梗博物馆', category: 'other', color: '#CCCCCC' })
    expect(path?.source?.sourceColor).toBe('#000000')
    expect(path?.source?.sourceColorPre).toBe(1)
  })

  it('applies the preset to 常陵 庆江 while preserving the source point count', () => {
    const { project } = convertAarcToActualRouteProject(rawChangling, '常陵.aarc-9.json')
    const source = (rawChangling.lines as Array<{ id: number; type?: number; pts: number[]; colorPre?: number; width?: number }>).find(line => line.id === 8)!
    const path = project.basemapPaths?.find(item => item.source?.sourceLineId === 8)!
    const points = new Map((rawChangling.points as unknown as Array<{ id: number; pos: [number, number] }>).map(point => [point.id, point.pos]))
    expect(path).toMatchObject({ color: '#C3E5EB', width: 126, closed: false, isFilled: false })
    expect(path.points).toHaveLength(source.pts.length)
    expect(path.points.map(point => [point.x, point.y])).toEqual(source.pts.map(id => points.get(id)))
  })

  it('round-trips imported terrain without losing effective fields or repeated terminal points', () => {
    const original = convertAarcToActualRouteProject(rawMinimal, '测试.aarc (1).json').project
    const restored = parseProjectJson(serializeProject(original))
    expect(restored.basemapPaths).toEqual(original.basemapPaths)
  })
  it('uses identical AARC formalize geometry for transit lines and terrain', () => {
    const controls = [
      { id: 1, x: 0, y: 0, dir: 0 as const, station: true },
      { id: 2, x: 20, y: 10, dir: 0 as const, station: false },
      { id: 3, x: 30, y: 10, dir: 1 as const, station: true },
    ]
    const line = reconstructAarcLineGeometry(controls).nodes.map(point => [point.x, point.y])
    const terrain = formalizeAarcBasemapPoints(controls.map(point => ({ id: String(point.id), x: point.x, y: point.y, aarcPointId: point.id, aarcDir: point.dir }))).map(point => [point.x, point.y])
    expect(line).toEqual(terrain)
  })

})
