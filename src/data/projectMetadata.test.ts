import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { getProjectName, normalizeProjectName, projectFilename, sanitizeFilenameStem } from './projectMetadata'
import { parseProjectJson, serializeProject } from '../import-export/projectJson'

describe('project metadata', () => {
  it('prefers explicit projectName while keeping legacy name fallback', () => {
    expect(getProjectName({ ...demoProject, projectName: '我的工程' })).toBe('我的工程')
    expect(getProjectName(demoProject)).toBe(demoProject.name)
    expect(normalizeProjectName('  ')).toBe('未命名工程')
  })
  it('round-trips projectName and distanceScale without changing geometry', () => {
    const project = structuredClone(demoProject)
    project.projectName = '南京/线路:图'
    project.distanceScale = { metersPerWorldUnit: 3.25 }
    const restored = parseProjectJson(serializeProject(project))
    expect(restored.projectName).toBe(project.projectName)
    expect(restored.distanceScale).toEqual(project.distanceScale)
    expect(restored.geometry).toEqual(project.geometry)
  })
  it('sanitizes only filename-invalid characters', () => {
    expect(sanitizeFilenameStem('  南京/线路:图?  ')).toBe('南京_线路_图_')
    expect(projectFilename({ name: '未命名', projectName: '工程' }, '.svg')).toBe('工程.svg')
  })
})
