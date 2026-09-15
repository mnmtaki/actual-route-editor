from pathlib import Path
p=Path(__file__).resolve().parents[1]/'src/renderer/NetworkCanvas.tsx'
text=p.read_text(encoding='utf-8')
old1="import type { ActualRouteProject, LineDraft, Road, Selection } from '../data/model'"
new1="import type { ActualRouteProject, LineDraft, LineDraftPoint, Road, Selection } from '../data/model'"
old2="import type { DrawingMode, LineDraftPoint } from '../data/basemapPaths'"
new2="import type { DrawingMode } from '../data/basemapPaths'"
if text.count(old1)!=1 or text.count(old2)!=1:
    raise RuntimeError('expected imports not found')
text=text.replace(old1,new1,1).replace(old2,new2,1)
p.write_text(text,encoding='utf-8')
print('Build82 LineDraftPoint import fixed')
