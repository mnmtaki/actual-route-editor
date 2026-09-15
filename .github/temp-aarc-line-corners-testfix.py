from pathlib import Path

path = Path('src/import-export/aarcGeometry.test.ts')
text = path.read_text(encoding='utf-8')
old = """  it('renders 禹庄 → 宗盛 as horizontal, compact 45° fillet, then diagonal', () => {\n    const project=imported(),segment=segmentBetween(project,39,40),spans=getSegmentPathSpans(project,segment)\n    expect(coordinates(segment)).toEqual([[6350,4500]])\n    expect(spans.map(span=>span.linear)).toEqual([true,false,true])\n    expect(spans[0].end.x).toBeCloseTo(6332.60303,5);expect(spans[0].end.y).toBe(4500)\n    expect(spans[1].control1.x-spans[1].start.x).toBeCloseTo(11.13909,4)\n    expect(spans[1].end.x-6350).toBeCloseTo(12.30152,4)\n    expect(spans.at(-1)?.end).toMatchObject({x:6450,y:4600})\n  })\n"""
new = """  it('renders 禹庄 → 宗盛 with the AARC 45° corner radius, then diagonal', () => {\n    const project=imported(),segment=segmentBetween(project,39,40),spans=getSegmentPathSpans(project,segment),line=project.lines.find(item=>item.id===segment.lineId)!\n    expect(coordinates(segment)).toEqual([[6350,4500]])\n    expect(spans.map(span=>span.linear)).toEqual([true,false,true])\n    const config=project.aarc?.config??{},widthRatio=Number(line.source?.sourceWidthRatio??1),base=(Number(config.lineTurnAreaRadius??30)+Number(config.lineWidth??14)/2)*widthRatio,trim=base/(2.4142135*.618)\n    expect(spans[0].end.x).toBeCloseTo(6350-trim,6);expect(spans[0].end.y).toBe(4500)\n    expect(spans[1].end.x-6350).toBeCloseTo(trim/Math.SQRT2,6)\n    expect(spans.at(-1)?.end).toMatchObject({x:6450,y:4600})\n  })\n"""
if text.count(old) != 1:
    raise SystemExit(f'aarcGeometry regression anchor mismatch: {text.count(old)}')
path.write_text(text.replace(old, new), encoding='utf-8')
