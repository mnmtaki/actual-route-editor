from pathlib import Path

# 1) Station model: preserve AARC free on stations just like Waypoint.free.
path = Path('src/data/model.ts')
text = path.read_text(encoding='utf-8')
old = "export interface Station { id: string; name: string; nameS?: string; nameHistory?: StationNameHistoryEntry[]; compoundGroupId?: string; x: number; y: number;"
new = "export interface Station { id: string; name: string; nameS?: string; nameHistory?: StationNameHistoryEntry[]; compoundGroupId?: string; /** AARC free control-point semantic when this station originates from a free station point. */ free?: boolean; x: number; y: number;"
if text.count(old) != 1:
    raise SystemExit(f'model Station anchor mismatch: {text.count(old)}')
path.write_text(text.replace(old, new), encoding='utf-8')

# 2) Import sta=1 + free=true directly onto Station.free.
path = Path('src/import-export/aarc.ts')
text = path.read_text(encoding='utf-8')
old = "        ...(typeof point.nameS === 'string' && point.nameS.length ? { nameS: point.nameS } : {}),\n        x: position[0], y: position[1],"
new = "        ...(typeof point.nameS === 'string' && point.nameS.length ? { nameS: point.nameS } : {}),\n        ...(point.free === true ? { free: true } : {}),\n        x: position[0], y: position[1],"
if text.count(old) != 1:
    raise SystemExit(f'aarc createStation anchor mismatch: {text.count(old)}')
text = text.replace(old, new)

# Ordinary cross-line clustering keeps one canonical Station. If any source station
# occurrence in that cluster is free, keep that semantic on the canonical Station.
old = "      const canonical = stationByPoint.get(component.canonicalPointId)\n      if (canonical) for (const pointId of component.pointIds) stationByPoint.set(pointId, canonical)"
new = "      const canonical = stationByPoint.get(component.canonicalPointId)\n      if (canonical) {\n        if (component.pointIds.some(pointId => pointMap.get(pointId)?.free === true)) canonical.free = true\n        for (const pointId of component.pointIds) stationByPoint.set(pointId, canonical)\n      }"
if text.count(old) != 1:
    raise SystemExit(f'aarc canonical station anchor mismatch: {text.count(old)}')
path.write_text(text.replace(old, new), encoding='utf-8')

# 3) Regression tests: import + native JSON roundtrip.
path = Path('src/import-export/aarcFreeSemantics.test.ts')
text = path.read_text(encoding='utf-8')
anchor = "import { buildAarcStationComponents, createAarcFreeSnapCandidateResolver } from './aarcStationClustering'\n"
addition = "import { convertAarcToActualRouteProject } from './aarc'\nimport { parseProjectJson, serializeProject } from './projectJson'\n"
if addition not in text:
    if text.count(anchor) != 1:
        raise SystemExit('aarcFreeSemantics import anchor mismatch')
    text = text.replace(anchor, anchor + addition)

insert = r'''
  it('preserves a free AARC station as Station.free through native JSON roundtrip', () => {
    const raw = {
      cvsSize: [300, 200],
      points: [
        { id: 1, pos: [0, 0], sta: 1, dir: 0, name: 'A' },
        { id: 2, pos: [80, 35], sta: 1, dir: 1, free: true, name: 'B' },
        { id: 3, pos: [160, 0], sta: 1, dir: 0, name: 'C' },
      ],
      lines: [{ id: 10, name: 'L', type: 0, pts: [1, 2, 3], color: '#123456', width: 1 }],
    }
    const project = convertAarcToActualRouteProject(raw).project
    expect(project.stations.find(station => station.source?.pointId === 1)?.free).toBeUndefined()
    expect(project.stations.find(station => station.source?.pointId === 2)?.free).toBe(true)
    expect(project.stations.find(station => station.source?.pointId === 3)?.free).toBeUndefined()

    const restored = parseProjectJson(serializeProject(project))
    expect(restored.stations.find(station => station.source?.pointId === 2)?.free).toBe(true)
  })

  it('marks a canonical clustered Station free when any clustered AARC station point is free', () => {
    const raw = {
      cvsSize: [300, 200],
      config: { snapOctaClingPtPtDist: 25 },
      points: [
        { id: 1, pos: [0, 0], sta: 1, dir: 0, name: 'A' },
        { id: 2, pos: [100, 0], sta: 1, dir: 0, name: 'X' },
        { id: 3, pos: [105, 0], sta: 1, dir: 0, free: true, name: 'X' },
        { id: 4, pos: [200, 0], sta: 1, dir: 0, name: 'B' },
      ],
      lines: [
        { id: 10, name: 'L1', type: 0, pts: [1, 2, 4], color: '#123456', width: 1 },
        { id: 11, name: 'L2', type: 0, pts: [1, 3, 4], color: '#654321', width: 1 },
      ],
    }
    const project = convertAarcToActualRouteProject(raw).project
    const clustered = project.stations.find(station => station.source?.pointIds?.includes(2) && station.source?.pointIds?.includes(3))
    expect(clustered?.free).toBe(true)
  })
'''
marker = '\n})\n'
if insert.strip() not in text:
    pos = text.rfind(marker)
    if pos < 0:
        raise SystemExit('aarcFreeSemantics describe ending missing')
    text = text[:pos] + insert + text[pos:]
path.write_text(text, encoding='utf-8')
