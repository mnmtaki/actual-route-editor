import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import rawPinglan from '../import-export/__fixtures__/平岚.aarc (9).json'
import { convertAarcToActualRouteProject } from '../import-export/aarc'
import { StationMarker } from './StationMarker'
import { getTransferMarkerLayout } from '../geometry/tangent'

describe('compound station marker', () => {
  it('renders the group as one horizontal marker with three dots', () => {
    const { project } = convertAarcToActualRouteProject(rawPinglan, '平岚.aarc (9).json')
    const station = project.stations.find(item => item.source?.pointId === 1239)!
    const { container } = render(<svg><StationMarker project={project} station={station} time="9999-12-31" selected={false} onPointerDown={() => {}} onLabelPointerDown={() => {}} /></svg>)
    expect(container.querySelectorAll('[data-testid^="transfer-"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid^="transfer-"] circle')).toHaveLength(3)
    expect(getTransferMarkerLayout(project, station.id, '9999-12-31').rotation).toBe(0)
  })
})
