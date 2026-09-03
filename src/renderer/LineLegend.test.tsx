import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { DEFAULT_LINE_LEGEND } from '../data/lineLegend'
import { LineLegendLayer } from './LineLegend'
import { exportSvg } from '../import-export/svgExport'

function projectWithLegend() {
  const project = structuredClone(demoProject)
  project.lines[0].name = '1'
  project.lines[1].name = '环线'
  project.lineLegend = { id: 'legend', x: 40, y: 60, ...DEFAULT_LINE_LEGEND }
  return project
}

describe('LineLegendLayer', () => {
  it('renders one solid strip per current visible line with terminal rows', () => {
    const project = projectWithLegend()
    const { container } = render(<svg><LineLegendLayer project={project} /></svg>)
    const legend = container.querySelector('[data-layer="line-legend"]')!
    expect(legend).toHaveAttribute('transform', 'translate(40 60) scale(1)')
    expect(legend.querySelector('.line-legend-title')?.textContent).toBe('线路')
    expect(legend.querySelector('.line-legend-foreign-title')?.textContent).toBe('Line')
    expect(legend.querySelectorAll('.line-legend-item')).toHaveLength(3)
    expect(legend.querySelector('[data-line-legend-line-id="line-a"] .line-legend-line-name')?.textContent).toBe('1号线')
    expect(legend.querySelector('[data-line-legend-line-id="line-a"] .line-legend-line-foreign')?.textContent).toBe('Line 1')
    expect(legend.querySelectorAll('.line-legend-strip')).toHaveLength(3)
    expect(legend.querySelector('[data-line-legend-line-id="line-a"] .line-legend-strip')).toHaveAttribute('fill', project.lines[0].color)
    expect(legend.querySelector('.line-legend-terminals')?.textContent).toContain('云港')
  })

  it('uses an editor hit area and removes it from presentation output', () => {
    const project = projectWithLegend()
    const editor = render(<svg><LineLegendLayer project={project} selectedId="legend" /></svg>)
    expect(editor.container.querySelector('.line-legend-hit')).toHaveAttribute('data-editor', 'true')
    expect(editor.container.querySelector('.line-legend-selection')).toHaveAttribute('data-editor', 'true')
    const presentation = render(<svg><LineLegendLayer project={project} presentation /></svg>)
    expect(presentation.container.querySelector('.line-legend-hit')).toBeNull()
  })

  it('does not render hidden legends or hidden lines', () => {
    const project = projectWithLegend()
    project.lineLegend!.visible = false
    expect(render(<svg><LineLegendLayer project={project} /></svg>).container.querySelector('[data-layer="line-legend"]')).toBeNull()
    project.lineLegend!.visible = true
    project.lines[1].visible = false
    const { container } = render(<svg><LineLegendLayer project={project} /></svg>)
    expect(container.querySelectorAll('.line-legend-item')).toHaveLength(2)
  })

  it('does not hit-test a locked legend on the canvas', () => {
    const project = projectWithLegend()
    project.lineLegend!.locked = true
    const { container } = render(<svg><LineLegendLayer project={project} /></svg>)
    const legend = container.querySelector('[data-layer="line-legend"]')!
    expect(legend).toHaveClass('locked')
    expect(legend).toHaveAttribute('pointer-events', 'none')
    expect(legend.querySelector('.line-legend-hit')).toBeNull()
  })

  it('keeps the formal legend layer in SVG export while stripping editor hit areas',()=>{
    const project=projectWithLegend(),{container}=render(<svg><LineLegendLayer project={project}/></svg>)
    const text=exportSvg(container.querySelector('svg')!,false)
    expect(text).toContain('data-layer="line-legend"')
    expect(text).toContain(project.lines[0].color)
    expect(text).not.toContain('data-editor="true"')
  })
})
