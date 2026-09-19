import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demo'
import { LineHistoryEditor } from './LineHistoryEditor'
import { Inspector } from './Inspector'

function projectWithCombinedHistory() {
  const project = structuredClone(demoProject)
  const line = project.lines.find(item => item.id === 'line-a')!
  line.nameHistory = [
    { id: 'name-base', effectiveAt: null, name: '1号线' },
    { id: 'name-2010', effectiveAt: '2010-01-01', name: '机场线' },
  ]
  line.name = '机场线'
  line.displayCode = 'A'
  line.displayCodeHistory = [
    { id: 'code-base', effectiveAt: null, displayCode: '1' },
    { id: 'code-2020', effectiveAt: '2020-01-01', displayCode: 'A' },
  ]
  line.colorHistory = [
    { id: 'color-base', effectiveAt: null, color: '#e54b3f' },
    { id: 'color-2010', effectiveAt: '2010-01-01', color: '#663399' },
  ]
  line.color = '#663399'
  line.parentHistory = [
    { id: 'parent-base', effectiveAt: null, parentLineId: null },
    { id: 'parent-2010', effectiveAt: '2010-01-01', parentLineId: 'line-b' },
    { id: 'parent-2020', effectiveAt: '2020-01-01', parentLineId: null },
  ]
  delete line.parentLineId
  project.timeline.currentDate = '2010-01-01'
  return project
}

describe('LineHistoryEditor', () => {
  it('combines identity changes by date and shows the current timeline snapshot', () => {
    const project = projectWithCombinedHistory()
    const line = project.lines.find(item => item.id === 'line-a')!
    const view = render(<LineHistoryEditor project={project} line={line} onChange={() => {}} />)
    expect(screen.getByTestId('line-history-editor')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-history-date="2010-01-01"]')).toHaveLength(1)
    expect(view.container.querySelector('[data-history-date="2010-01-01"]')).toHaveAttribute('data-current-timeline-date', 'true')
    expect(screen.getByTestId('line-history-current-summary')).toHaveTextContent('机场线')
    expect(screen.getByTestId('line-history-current-summary')).toHaveTextContent('支线')
  })

  it('adds a code change to an existing date without disturbing name, parent, or color changes', () => {
    const project = projectWithCombinedHistory()
    const onChange = vi.fn()
    render(<LineHistoryEditor project={project} line={project.lines[0]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('2010-01-01 线路代码'), { target: { value: '1A' } })
    const next = onChange.mock.calls.at(-1)![0]
    const line = next.lines.find((item: { id: string }) => item.id === 'line-a')
    expect(line.displayCodeHistory.some((entry: { effectiveAt: string | null; displayCode: string }) => entry.effectiveAt === '2010-01-01' && entry.displayCode === '1A')).toBe(true)
    expect(line.nameHistory.some((entry: { id: string }) => entry.id === 'name-2010')).toBe(true)
    expect(line.parentHistory.some((entry: { id: string }) => entry.id === 'parent-2010')).toBe(true)
    expect(line.colorHistory.some((entry: { id: string }) => entry.id === 'color-2010')).toBe(true)
  })

  it('removes one field change without deleting the other changes on the same date', () => {
    const project = projectWithCombinedHistory()
    project.lines[0].displayCodeHistory!.splice(1, 0, { id: 'code-2010', effectiveAt: '2010-01-01', displayCode: '1A' })
    const onChange = vi.fn()
    render(<LineHistoryEditor project={project} line={project.lines[0]} onChange={onChange} />)
    const row = screen.getByLabelText('2010-01-01 生效日期').closest('[data-history-date="2010-01-01"]')!\n    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: '取消此日代码变化' }))
    const next = onChange.mock.calls.at(-1)![0]
    const line = next.lines[0]
    expect(line.displayCodeHistory?.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2010-01-01')).toBe(false)
    expect(line.nameHistory.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2010-01-01')).toBe(true)
    expect(line.parentHistory.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2010-01-01')).toBe(true)
    expect(line.colorHistory.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2010-01-01')).toBe(true)
  })

  it('creates a draft node from the editor timeline date and persists only the field that is changed', () => {
    const project = projectWithCombinedHistory()
    project.timeline.currentDate = '2015-06-01'
    const onChange = vi.fn()
    const view = render(<LineHistoryEditor project={project} line={project.lines[0]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加发展史节点' }))
    expect(view.container.querySelector('[data-history-date="2015-06-01"]')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('2015-06-01 线路名称'), { target: { value: '机场快线' } })
    const next = onChange.mock.calls.at(-1)![0]
    expect(next.lines[0].nameHistory.some((entry: { effectiveAt: string | null; name: string }) => entry.effectiveAt === '2015-06-01' && entry.name === '机场快线')).toBe(true)
    expect(next.lines[0].displayCodeHistory.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2015-06-01')).toBe(false)
    expect(next.lines[0].parentHistory.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2015-06-01')).toBe(false)
    expect(next.lines[0].colorHistory.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2015-06-01')).toBe(false)
  })

  it('moves every change on a combined date together', () => {
    const project = projectWithCombinedHistory()
    const onChange = vi.fn()
    render(<LineHistoryEditor project={project} line={project.lines[0]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('2010-01-01 生效日期'), { target: { value: '2011-02-03' } })
    const next = onChange.mock.calls.at(-1)![0]
    const line = next.lines[0]
    expect(line.nameHistory.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2011-02-03')).toBe(true)
    expect(line.parentHistory.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2011-02-03')).toBe(true)
    expect(line.colorHistory.some((entry: { effectiveAt: string | null }) => entry.effectiveAt === '2011-02-03')).toBe(true)
  })

  it('is the single history surface in the selected Line inspector', () => {
    const project = projectWithCombinedHistory()
    const view = render(<Inspector project={project} selection={{ type: 'line', id: 'line-a' }} onChange={() => {}} onDelete={() => {}} onPhasePreview={() => {}} onStartPhaseDrawing={() => {}} />)
    expect(screen.getByTestId('line-history-editor')).toBeTruthy()
    expect(view.container.querySelector('[data-testid="line-name-history"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="line-display-code-history"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="line-parent-history"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="line-color-history"]')).toBeNull()
  })
})
