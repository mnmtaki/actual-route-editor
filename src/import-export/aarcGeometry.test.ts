import { describe, expect, it } from 'vitest'
import rawSample from './__fixtures__/木阳.aarc.json'
import type { ActualRouteProject, Segment } from '../data/model'
import { buildRoundedPolylineSpans, getCircularFilletMetrics, getSegmentCurveSamples, getSegmentPath, getSegmentPathSpans } from '../geometry/path'
import { classifyLeg, reconstructAarcLineGeometry, type AarcGeometryPoint } from './aarcGeometry'
import { convertAarcToActualRouteProject } from './aarc'

const point = (id: number, x: number, y: number, dir: 0 | 1, station = true): AarcGeometryPoint => ({ id, x, y, dir, station })
const imported = () => convertAarcToActualRouteProject(rawSample, '木阳.aarc.json').project
const segmentBetween = (project: ActualRouteProject, a: number, b: number) => project.geometry.segments.find(segment => {
  const ids = [segment.fromStationId, segment.toStationId]
  return ids.includes(`aarc-station-${a}`) && ids.includes(`aarc-station-${b}`)
})!
const coordinates = (segment: Segment) => segment.waypoints.map(waypoint => [waypoint.x, waypoint.y])

describe('AARC octilinear chain reconstruction', () => {
  it('uses whole-chain context for 锦头 → 合蔺 and preserves a local rounded corner', () => {
    const result = reconstructAarcLineGeometry([
      point(16, 5000, 3400, 0), point(15, 5250, 3400, 0), point(14, 5450, 3600, 0), point(13, 5450, 3850, 0),
    ])
    expect(result.orientations).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical'])
    expect(result.nodes.map(node => [node.x, node.y])).toContainEqual([5450, 3400])
    const project = imported(), segment = segmentBetween(project, 15, 14)
    expect(coordinates(segment)).toEqual([[5450, 3400]])
    const spans = getSegmentPathSpans(project, segment)
    expect(spans.map(span => span.linear)).toEqual([true, false, true])
    expect(getSegmentPath(project, segment)).toContain(' C ')
    expect(spans[0].start).toMatchObject({ x: 5250, y: 3400 })
    expect(spans.at(-1)?.end).toMatchObject({ x: 5450, y: 3600 })
  })

  it('chooses [3900,4500], not the mirrored wrong bend, for 妙和里 → 惠模', () => {
    const result = reconstructAarcLineGeometry([
      point(70, 3900, 4950, 0), point(52, 3900, 4700, 0), point(51, 4000, 4500, 0), point(50, 4250, 4500, 0),
    ])
    expect(result.nodes.map(node => [node.x, node.y])).toContainEqual([3900, 4500])
    expect(result.nodes.map(node => [node.x, node.y])).not.toContainEqual([4000, 4700])
    expect(coordinates(segmentBetween(imported(), 52, 51))).toEqual([[3900, 4500]])
  })

  it('keeps direct horizontal, vertical, and diagonal legs free of redundant corners', () => {
    const project = imported()
    expect(coordinates(segmentBetween(project, 16, 15))).toEqual([])
    expect(coordinates(segmentBetween(project, 14, 13))).toEqual([])
    expect(coordinates(segmentBetween(project, 20, 19))).toEqual([])
  })

  it('resolves orthogonal to diagonal through an implicit intersection, never an arbitrary angle', () => {
    const result = reconstructAarcLineGeometry([
      point(22, 4100, 2500, 0), point(21, 4100, 2750, 0), point(20, 4200, 2950, 1), point(19, 4375, 3125, 1),
    ])
    expect(result.orientations).toEqual(['vertical', 'vertical', 'diag-positive', 'diag-positive'])
    expect(result.nodes.map(node => [node.x, node.y])).toContainEqual([4100, 2850])
    expect(coordinates(segmentBetween(imported(), 21, 20))).toEqual([[4100, 2850]])
  })

  it('locks the 楚阳街 → 木阳站 maximal legal -45° run without any detour', () => {
    const chain=[
      point(60,5250,5000,0),point(63,5425,4825,1),point(64,5575,4675,1),point(61,5750,4500,0),point(81,5925,4325,0),point(82,6100,4150,0),point(83,6275,3975,1),
    ]
    const result=reconstructAarcLineGeometry(chain)
    expect(result.orientations).toEqual(chain.map(()=> 'diag-negative'))
    expect(result.stats).toMatchObject({implicitCornerCount:0,lockedDirectEdgeCount:6})
    expect(result.nodes).toHaveLength(7)
    const project=imported()
    for(const [a,b] of [[60,63],[63,64],[64,61],[61,81],[81,82],[82,83]]){
      const segment=segmentBetween(project,a,b)
      expect(segment.waypoints).toEqual([])
      expect(getSegmentPath(project,segment)).not.toContain(' C ')
      expect(classifyLeg(project.stations.find(station=>station.id===segment.fromStationId)!,project.stations.find(station=>station.id===segment.toStationId)!)).toBe('diagonal')
    }
  })

  it('keeps Point66 as one explicit control point inside 长扬坊 → 楚阳街 without rerouting it', () => {
    const project=imported(),segment=segmentBetween(project,65,60)
    expect(project.stations.some(station=>station.source?.pointId===66)).toBe(false)
    expect(project.lines.find(line=>line.id==='aarc-line-62')?.stationSequence).not.toContain('aarc-station-66')
    expect(project.stationLineRelations.some(relation=>relation.stationId==='aarc-station-66')).toBe(false)
    expect(project.geometry.segments.filter(item=>item.fromStationId==='aarc-station-66'||item.toStationId==='aarc-station-66')).toEqual([])
    expect(segment.waypoints).toEqual([expect.objectContaining({x:5200,y:5050,source:expect.objectContaining({pointId:66,kind:'explicit-control-point'})})])
    expect(project.geometry.segments.filter(item=>item.waypoints.some(waypoint=>waypoint.source?.pointId===66))).toEqual([segment])
    const skeleton=[project.stations.find(station=>station.id===segment.fromStationId)!,...segment.waypoints,project.stations.find(station=>station.id===segment.toStationId)!]
    expect(skeleton.map(value=>[value.x,value.y])).toEqual([[5050,5050],[5200,5050],[5250,5000]])
    expect(skeleton.slice(1).map((value,index)=>classifyLeg(skeleton[index],value))).toEqual(['horizontal','diagonal'])
    const spans=getSegmentPathSpans(project,segment),samples=getSegmentCurveSamples(project,segment,48)
    expect(spans.filter(span=>!span.linear)).toHaveLength(1)
    expect(samples.every((sample,index)=>index===0||sample.x>=samples[index-1].x-1e-7)).toBe(true)
    expect(Math.max(...samples.map(sample=>sample.x))).toBeLessThanOrEqual(5250)
    expect(Math.min(...samples.map(sample=>sample.y))).toBeGreaterThanOrEqual(5000)
  })

  it('uses true circular radius math for 45° and 90° local fillets', () => {
    const diagonal=getCircularFilletMetrics(42,Math.PI/4)
    expect(diagonal.trimDistance).toBeCloseTo(17.39697,5)
    expect(diagonal.handleLength).toBeCloseTo(11.13909,5)
    const rightAngle=getCircularFilletMetrics(42,Math.PI/2)
    expect(rightAngle.trimDistance).toBeCloseTo(42,8)
    expect(rightAngle.handleLength).toBeCloseTo(23.19596,5)
  })

  it('clamps two adjacent corner trims without overlap or tangent reversal', () => {
    const spans=buildRoundedPolylineSpans([{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:40,y:20}],42)
    expect(spans.filter(span=>!span.linear)).toHaveLength(2)
    for(let index=1;index<spans.length;index+=1){expect(spans[index].start.x).toBeCloseTo(spans[index-1].end.x,10);expect(spans[index].start.y).toBeCloseTo(spans[index-1].end.y,10)}
    expect(spans.every(span=>[span.start,span.control1,span.control2,span.end].every(point=>point.x>=0&&point.x<=40&&point.y>=0&&point.y<=20))).toBe(true)
  })

  it('renders 禹庄 → 宗盛 as horizontal, compact 45° fillet, then diagonal', () => {
    const project=imported(),segment=segmentBetween(project,39,40),spans=getSegmentPathSpans(project,segment)
    expect(coordinates(segment)).toEqual([[6350,4500]])
    expect(spans.map(span=>span.linear)).toEqual([true,false,true])
    expect(spans[0].end.x).toBeCloseTo(6332.60303,5);expect(spans[0].end.y).toBe(4500)
    expect(spans[1].control1.x-spans[1].start.x).toBeCloseTo(11.13909,4)
    expect(spans[1].end.x-6350).toBeCloseTo(12.30152,4)
    expect(spans.at(-1)?.end).toMatchObject({x:6450,y:4600})
  })
  it('produces only horizontal, vertical, or diagonal skeleton legs for the full real sample', () => {
    const project = imported()
    for (const segment of project.geometry.segments) {
      const from = project.stations.find(station => station.id === segment.fromStationId)!
      const to = project.stations.find(station => station.id === segment.toStationId)!
      const points = [from, ...segment.waypoints, to]
      for (let index = 1; index < points.length; index += 1) expect(classifyLeg(points[index - 1], points[index])).not.toBe('invalid')
    }
  })

  it('keeps every imported Station at its exact source point.pos', () => {
    const project = imported()
    const sourcePoints = new Map((rawSample.points as unknown as Array<{ id: number; pos: [number, number]; sta: number }>).filter(point => point.sta === 1).map(point => [point.id, point.pos]))
    for (const station of project.stations) {
      const sourcePosition = sourcePoints.get(station.source!.pointId!)
      expect(sourcePosition).toBeDefined()
      expect([station.x, station.y]).toEqual(sourcePosition)
    }
  })
  it('is deterministic for the complete 木阳 sample', () => {
    const first = convertAarcToActualRouteProject(rawSample, '木阳.aarc.json')
    const second = convertAarcToActualRouteProject(rawSample, '木阳.aarc.json')
    expect(second.project.geometry).toEqual(first.project.geometry)
    expect(second.summary).toEqual(first.summary)
  })
})