import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { expect, it } from 'vitest'

it('keeps a cold SDK import within an eighty-module dependency budget while retaining Subject semantics', () => {
	const entry = path.resolve(__dirname, '../../dist/index.js')
	const reactive = path.resolve(__dirname, '../../dist/shared/ReactiveSubject.js')
	const source = `require(${JSON.stringify(entry)});const {ReactiveSubject}=require(${JSON.stringify(reactive)});const subject=new ReactiveSubject();const values=[];const subscription=subject.subscribe(value=>values.push(value));subject.next(7);subscription.unsubscribe();console.log(JSON.stringify({modules:Object.keys(require.cache).length,values,closed:subject.closed}))`
	const child = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8' })
	expect(child.status, child.stderr).toBe(0)
	const result = JSON.parse(child.stdout)
	expect(result.values).toEqual([7])
	expect(result.closed).toBe(true)
	// The SDK needs Subject, not the complete operator barrel; measure the actual loaded graph.
	expect(result.modules).toBeLessThanOrEqual(80)
})
