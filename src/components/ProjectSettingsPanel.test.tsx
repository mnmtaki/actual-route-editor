import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { ProjectSettingsPanel } from './ProjectSettingsPanel'

describe('ProjectSettingsPanel', () => {
  it('commits a project name once on blur and normalizes blanks', () => {
    const onChange = vi.fn(), project = structuredClone(demoProject)
    render(<ProjectSettingsPanel project={project} onChange={onChange} />)
    const input = screen.getByLabelText('工程名称')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '  新工程  ' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toMatchObject({ projectName: '新工程', name: '新工程' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: ' ' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1][0].projectName).toBe('未命名工程')
  })
  it('commits an explicit manual distance scale and exposes calibration', () => {
    const onChange = vi.fn(), onStartCalibration = vi.fn(), project = structuredClone(demoProject)
    render(<ProjectSettingsPanel project={project} onChange={onChange} onStartCalibration={onStartCalibration} />)
    const input = screen.getByLabelText('每坐标单位米数')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '2.5' } })
    fireEvent.blur(input)
    expect(onChange.mock.calls.at(-1)?.[0].distanceScale).toEqual({ metersPerWorldUnit: 2.5 })
    fireEvent.click(screen.getByRole('button', { name: '两点标定' }))
    expect(onStartCalibration).toHaveBeenCalledTimes(1)
  })
})
