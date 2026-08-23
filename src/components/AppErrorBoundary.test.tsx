import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

function BrokenComponent(): never { throw new Error('诊断用渲染错误') }

describe('AppErrorBoundary', () => {
  it('shows a visible diagnostic instead of leaving a blank root', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getByRole, getByText } = render(<AppErrorBoundary><BrokenComponent /></AppErrorBoundary>)
    expect(getByRole('alert')).toBeVisible()
    expect(getByText('应用加载失败')).toBeVisible()
    expect(getByText(/诊断用渲染错误/)).toBeVisible()
  })
})
