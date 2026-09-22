import { memo, useMemo } from 'react'
import type { ActualRouteProject, Segment } from '../data/model'
import { SegmentArtwork, StructureRunArtwork } from './segmentStyles'
import { AarcFakeLinesLayer } from './AarcFakeLines'
import { compileNetworkLineScene } from './scene/networkScene'

export interface NetworkLineLayerProps {
  project: ActualRouteProject
  includeLineIds?: ReadonlySet<string>
  excludeArtworkLineIds?: ReadonlySet<string>
  renderHits?: boolean
  onSegmentPointerDown?: (event: React.PointerEvent<SVGPathElement>, segment: Segment) => void
  overlay?: boolean
}

/**
 * SVG adapter for the shared network scene. Timeline/style/path calculations
 * live in compileNetworkLineScene so another renderer can consume the same
 * drawing data without depending on React or SVG.
 */
export const NetworkLineLayer = memo(function NetworkLineLayer({
  project,
  includeLineIds,
  excludeArtworkLineIds,
  renderHits = true,
  onSegmentPointerDown,
  overlay = false,
}: NetworkLineLayerProps) {
  const scene = useMemo(
    () => compileNetworkLineScene(project, includeLineIds, excludeArtworkLineIds),
    [project, includeLineIds, excludeArtworkLineIds],
  )

  return <>
    <g data-layer={overlay ? 'segments-active-overlay' : 'segments'} data-static-network-layer={overlay ? undefined : 'lines'} pointerEvents={overlay ? 'none' : undefined}>
      {scene.lines.map(item => {
        if (item.kind === 'fake-aarc') {
          return <AarcFakeLinesLayer key={item.id} project={project} part="common" sourceLineId={item.sourceLineId} />
        }
        return <g key={item.id} data-aarc-continuous-line={item.aarcContinuous ? item.lineId : undefined}>
          {item.artworks.map(artwork => <SegmentArtwork
            key={artwork.id}
            segment={artwork.segment}
            line={artwork.line}
            path={artwork.path}
            lineWidth={artwork.lineWidth}
            renderLegacyStructure={false}
            style={artwork.style}
          />)}
          {renderHits && onSegmentPointerDown && item.hits.map(hit => <path
            key={`hit:${hit.segment.id}`}
            d={hit.path}
            className="segment-hit"
            onPointerDown={event => onSegmentPointerDown(event, hit.segment)}
          />)}
        </g>
      })}
    </g>
    <g data-layer={overlay ? 'structure-runs-active-overlay' : 'structure-runs'} data-static-network-layer={overlay ? undefined : 'structure-runs'} pointerEvents={overlay ? 'none' : undefined}>
      {scene.structures.map(item => <StructureRunArtwork
        key={item.id}
        run={item.run}
        line={item.line}
        lineWidth={item.lineWidth}
        style={item.style}
      />)}
    </g>
  </>
})
