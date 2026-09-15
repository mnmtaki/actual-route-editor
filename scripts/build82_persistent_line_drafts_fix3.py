from pathlib import Path
p=Path(__file__).resolve().parents[1]/'src/App.tsx'
text=p.read_text(encoding='utf-8')
old='window.confirm("删除这段未完成线路草稿？\n已完成的车站和站间区间不会受影响。")'
# old above contains a real newline in Python string; replace with an escaped TS newline.
new='window.confirm("删除这段未完成线路草稿？\\n已完成的车站和站间区间不会受影响。")'
if old not in text:
    raise RuntimeError('broken confirm string not found')
p.write_text(text.replace(old,new,1),encoding='utf-8')
print('Build82 multiline string fixed')
