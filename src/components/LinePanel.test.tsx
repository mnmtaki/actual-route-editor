import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { demoProject } from '../data/demo'
import { LinePanel } from './LinePanel'
describe('line structure panel',()=>{
 it('keeps line structure but no longer renders global style controls',()=>{render(<LinePanel project={structuredClone(demoProject)} selection={null} activeLineId={null} onSelect={()=>{}} onChange={()=>{}} onAddLine={()=>{}}/>);expect(screen.getByRole('complementary',{name:'线路结构'})).toBeTruthy();expect(screen.queryByText('线路宽度')).toBeNull();expect(screen.queryByText('中文站名字号')).toBeNull()})
})