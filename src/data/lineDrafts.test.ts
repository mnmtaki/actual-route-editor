import { describe, expect, it } from 'vitest'
import { demoProject } from './demo'
import { cleanLineDraftReferences, createLineDraft, deleteLineDraft, normalizeLineDrafts, replaceLineDraft } from './lineDrafts'

describe('persistent line drafts', () => {
  it('creates, updates and deletes editor-only incomplete tails without creating Segments', () => {
    const base=structuredClone(demoProject),beforeSegments=base.geometry.segments.length
    const created=createLineDraft(base,'line-a','s4')
    let next=replaceLineDraft(created.project,{id:created.draftId,lineId:'line-a',anchorStationId:'s4',points:[{id:'p1',x:700,y:360}]})
    expect(next.lineDrafts?.[0].points).toHaveLength(1)
    expect(next.geometry.segments).toHaveLength(beforeSegments)
    next=deleteLineDraft(next,created.draftId)
    expect(next.lineDrafts).toBeUndefined()
  })
  it('normalizes finite saved points and drops orphan/empty drafts at load cleanup', () => {
    const raw=normalizeLineDrafts([{id:'good',lineId:'line-a',anchorStationId:'s4',points:[{id:'p',x:1,y:2}]},{id:'bad',lineId:'line-a',anchorStationId:'s4',points:[{id:'p',x:'x',y:2}]}])!
    const project=structuredClone(demoProject);project.lineDrafts=raw
    const cleaned=cleanLineDraftReferences(project)
    expect(cleaned.lineDrafts?.map(item=>item.id)).toEqual(['good'])
  })
})
