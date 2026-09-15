from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text(encoding='utf-8')
def write(path, text): (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected one match for {old[:100]!r}, got {text.count(old)}')
    write(path, text.replace(old, new, 1))

history_path = 'src/history/useProjectHistory.test.ts'
history_test = read(history_path)
history_test = history_test.replace("import { useProjectHistory } from './useProjectHistory'", "import { useProjectHistory } from './useProjectHistory'\nimport { createLineDraft, replaceLineDraft } from '../data/lineDrafts'", 1)
closing = history_test.rstrip()
if not closing.endswith('})'):
    raise RuntimeError('useProjectHistory.test.ts ending changed')
closing = closing[:-2]
history_insert = r'''

  it('undoes and redoes one unfinished line-draft edit as project history', () => {
    const {result}=renderHook(()=>useProjectHistory(structuredClone(demoProject)))
    let draftId=''
    act(()=>{const created=createLineDraft(result.current.project,'line-a','s4');draftId=created.draftId;result.current.replace(created.project)})
    act(()=>result.current.commit(current=>replaceLineDraft(current,{id:draftId,lineId:'line-a',anchorStationId:'s4',points:[{id:'p1',x:700,y:360}]})))
    expect(result.current.project.lineDrafts?.[0].points).toHaveLength(1)
    act(()=>result.current.undo())
    expect(result.current.project.lineDrafts?.[0].points).toHaveLength(0)
    act(()=>result.current.redo())
    expect(result.current.project.lineDrafts?.[0].points).toHaveLength(1)
  })
'''
write(history_path, closing + history_insert + '})\n')
replace_once('src/build.ts', "export const BUILD_VERSION = '2026-09-14-repeated-operation-history-81-2'", "export const BUILD_VERSION = '2026-09-15-persistent-line-drafts-82'")
print('Build82 completion patch applied')
