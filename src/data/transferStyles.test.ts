import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { assignTransferStyle, createTransferStyle, deleteTransferStyle, resolveTransferStyle, updateTransferStyle } from './transferStyles'

describe('TransferStyle project and logical identity', () => {
  it('resolves a built-in style from the project default', () => {
    const project = structuredClone(demoProject)
    project.defaultTransferStyleId = 'transfer.shanghai.default'
    expect(resolveTransferStyle(project, project.stations[1])).toMatchObject({ id: 'transfer.shanghai.default', template: 'shanghai' })
  })

  it('applies and clears one style across all compound members', () => {
    const project = structuredClone(demoProject)
    project.stations[1].compoundGroupId = 'group'
    project.stations.push({ ...project.stations[1], id: 'member', compoundGroupId: 'group', x: 391, y: 351 })
    const applied = assignTransferStyle(project, ['member'], 'transfer.beijing.default')
    expect(applied.stations.filter(station => station.compoundGroupId === 'group').map(station => station.transferStyleId)).toEqual(['transfer.beijing.default', 'transfer.beijing.default'])
    const cleared = assignTransferStyle(applied, ['s2'])
    expect(cleared.stations.filter(station => station.compoundGroupId === 'group').every(station => station.transferStyleId === undefined)).toBe(true)
  })

  it('copies, updates and protects built-ins', () => {
    const copied = createTransferStyle(structuredClone(demoProject), 'transfer.kunming.two', '昆明自定义')
    expect(copied.project.transferStyles?.find(style => style.id === copied.styleId)).toMatchObject({ name: '昆明自定义', template: 'kunming' })
    const updated = updateTransferStyle(copied.project, copied.styleId, { shellStrokeWidth: 3 })
    expect(updated.transferStyles?.find(style => style.id === copied.styleId)?.shellStrokeWidth).toBe(3)
    expect(updateTransferStyle(updated, 'transfer.kunming.two', { shellStrokeWidth: 5 })).toBe(updated)
    expect(deleteTransferStyle(updated, 'transfer.kunming.two')).toEqual(updated)
  })

  it('copies Kunming as one dynamic template rather than a service-count snapshot', () => {
    const copied = createTransferStyle(structuredClone(demoProject), 'transfer.kunming.three', '昆明动态自定义')
    const style = copied.project.transferStyles?.find(item => item.id === copied.styleId)
    expect(style).toMatchObject({ name: '昆明动态自定义', template: 'kunming', minServiceCount: 2 })
    expect(style?.maxServiceCount).toBeUndefined()
  })
})
