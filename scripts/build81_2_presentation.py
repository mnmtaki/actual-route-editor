from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text(encoding='utf-8')
def write(path, text): (ROOT / path).write_text(text, encoding='utf-8')
def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, got {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))

replace_once(
    'src/presentation/compiler.ts',
    "import { isLineOperationalAt, isRelationOperationalAt, isSegmentOperationalAt } from '../data/operationEvents'",
    "import { isLineOperationalAt, isRelationOperationalAt, isSegmentOperationalAt } from '../data/operationEvents'\nimport { isStationLineServiceActiveAt } from '../timeline/active'",
)
replace_once(
    'src/presentation/compiler.ts',
    "function activeLinesForAllStations(project: ActualRouteProject, date: string) { const lines = new Map(project.lines.map(line => [line.id, line])), result: Record<string, string[]> = {}; for (const relation of project.stationLineRelations) { const line = lines.get(relation.lineId); if (!line || !isRelationOperationalAt(relation,date) || !isLineOperationalAt(line,date)) continue; result[relation.stationId] = [...(result[relation.stationId] ?? []), line.id] } for (const ids of Object.values(result)) ids.sort((a, b) => compareLines(lines.get(a), lines.get(b))); return result }",
    "function activeLinesForAllStations(project: ActualRouteProject, date: string) { const lines = new Map(project.lines.map(line => [line.id, line])), result: Record<string, string[]> = {}; for (const relation of project.stationLineRelations) { const line = lines.get(relation.lineId); if (!line || !isStationLineServiceActiveAt(project, relation, date)) continue; result[relation.stationId] = [...(result[relation.stationId] ?? []), line.id] } for (const ids of Object.values(result)) ids.sort((a, b) => compareLines(lines.get(a), lines.get(b))); return result }",
)
replace_once(
    'src/presentation/compiler.ts',
    "function activeLineIds(project: ActualRouteProject, stationId: string, date: string) { const memberIds = new Set(getCompoundStationMemberIds(project, stationId)); return project.stationLineRelations.filter(relation => memberIds.has(relation.stationId) && isRelationOperationalAt(relation,date) && isLineOperationalAt(project.lines.find(line => line.id === relation.lineId),date)).map(relation => relation.lineId) }",
    "function activeLineIds(project: ActualRouteProject, stationId: string, date: string) { const memberIds = new Set(getCompoundStationMemberIds(project, stationId)); return project.stationLineRelations.filter(relation => memberIds.has(relation.stationId) && isStationLineServiceActiveAt(project, relation, date)).map(relation => relation.lineId) }",
)
replace_once(
    'src/presentation/compiler.ts',
    "  for (const relation of project.stationLineRelations) for (const entry of relation.operationHistory ?? []) if (entry.state === 'open' && validDate(entry.effectiveAt) && entry.effectiveAt >= start && entry.effectiveAt <= end && !covered.has(`${entry.effectiveAt}\\u0000${relation.lineId}\\u0000${relation.stationId}`)) { const before=activeLineIds(project,relation.stationId,previousDate(entry.effectiveAt)).length,after=activeLineIds(project,relation.stationId,entry.effectiveAt).length,interchangeStationIds=after>=2&&after>before?[relation.stationId]:[]; events.push({ id: `${entry.effectiveAt}-${relation.lineId}-station-reopen-${relation.stationId}-${entry.id}`, type: 'STATION_OPENING', eventTypes: ['STATION_OPENING', ...(interchangeStationIds.length ? ['INTERCHANGE_CREATED' as const] : [])], historyDate: entry.effectiveAt, lineId: relation.lineId, segmentIds: [], stationIds: [relation.stationId], interchangeStationIds, branches: [] }) }",
    "  for (const relation of project.stationLineRelations) for (const entry of relation.operationHistory ?? []) if (entry.state === 'open' && validDate(entry.effectiveAt) && entry.effectiveAt >= start && entry.effectiveAt <= end && !covered.has(`${entry.effectiveAt}\\u0000${relation.lineId}\\u0000${relation.stationId}`)) { const activeAfter=activeLineIds(project,relation.stationId,entry.effectiveAt); if(!activeAfter.includes(relation.lineId)) continue; const before=activeLineIds(project,relation.stationId,previousDate(entry.effectiveAt)).length,after=activeAfter.length,interchangeStationIds=after>=2&&after>before?[relation.stationId]:[]; events.push({ id: `${entry.effectiveAt}-${relation.lineId}-station-reopen-${relation.stationId}-${entry.id}`, type: 'STATION_OPENING', eventTypes: ['STATION_OPENING', ...(interchangeStationIds.length ? ['INTERCHANGE_CREATED' as const] : [])], historyDate: entry.effectiveAt, lineId: relation.lineId, segmentIds: [], stationIds: [relation.stationId], interchangeStationIds, branches: [] }) }",
)

replace_once(
    'src/presentation/engine.ts',
    "import { isRelationOperationalAt, isSegmentOperationalAt } from '../data/operationEvents'",
    "import { isSegmentOperationalAt } from '../data/operationEvents'\nimport { isStationLineServiceActiveAt } from '../timeline/active'",
)
replace_once(
    'src/presentation/engine.ts',
    "&& isRelationOperationalAt(relation, date)",
    "&& isStationLineServiceActiveAt(project, relation, date)",
)

write('src/presentation/repeatedOperationHistory.test.ts', r'''import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { createOperationEvent } from '../data/operationEvents'
import { getOpeningPhasePathCandidates } from '../data/openingPhases'
import { compileHistoryEvents, compilePresentation } from './compiler'
import { getPresentationState } from './engine'

describe('presentation repeated operation history', () => {
  it('compiles closure followed by a later network reopening and ends visible again', () => {
    let project = structuredClone(demoProject)
    const path = getOpeningPhasePathCandidates(project, 'line-a', 's1', 's4')[0]
    project = createOperationEvent(project, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path }).project
    project = createOperationEvent(project, { lineId: 'line-a', effectiveAt: '2035-01-01', state: 'open', path }).project
    const settings = { ...project.presentation, startDate: '2029-01-01', endDate: '2036-01-01' }
    const events = compileHistoryEvents(project, settings)
    expect(events.some(event => event.historyDate === '2030-01-01' && event.eventTypes.includes('LINE_CLOSURE'))).toBe(true)
    expect(events.some(event => event.historyDate === '2035-01-01' && event.eventTypes.includes('SEGMENT_OPENING'))).toBe(true)
    const sequence = compilePresentation(project, settings)
    const final = getPresentationState(project, sequence, sequence.duration)
    expect(final.segmentStates['a-2'].opacity).toBeGreaterThan(0)
    expect(final.stationStates.s3.lineIds).toContain('line-a')
  })

  it('does not compile a station-only reopening while its parent network remains stopped', () => {
    let project = structuredClone(demoProject)
    const path = getOpeningPhasePathCandidates(project, 'line-a', 's1', 's4')[0]
    project = createOperationEvent(project, { lineId: 'line-a', effectiveAt: '2030-01-01', state: 'closed', path }).project
    const relation = project.stationLineRelations.find(item => item.stationId === 's3' && item.lineId === 'line-a')!
    relation.operationHistory = [...(relation.operationHistory ?? []), { id: 'manual-open', effectiveAt: '2035-01-01', state: 'open' }]
    const settings = { ...project.presentation, startDate: '2029-01-01', endDate: '2036-01-01' }
    const events = compileHistoryEvents(project, settings)
    expect(events.some(event => event.historyDate === '2035-01-01' && event.type === 'STATION_OPENING' && event.stationIds.includes('s3'))).toBe(false)
  })
})
''')

replace_once('src/build.ts', "export const BUILD_VERSION = '2026-09-14-repeated-operation-history-81-1'", "export const BUILD_VERSION = '2026-09-14-repeated-operation-history-81-2'")
print('Build81.2 presentation lifecycle patch applied')
