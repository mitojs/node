import { describe, expect, it } from 'vitest'
import { DataSource, DEFAULT_TCP_PORT, IpcMessageCode, ListenerResultType, MITO_NODE, SubjectNames } from '../constants'

describe('constants', () => {
	describe('SubjectNames', () => {
		it('should define all expected subject names', () => {
			expect(SubjectNames.CPU).toBe('CPU')
			expect(SubjectNames.JSError).toBe('JSError')
			expect(SubjectNames.Memory).toBe('Memory')
			expect(SubjectNames.Timeout).toBe('Timeout')
			expect(SubjectNames.FD).toBe('FD')
			expect(SubjectNames.HeapSnapshot).toBe('HeapSnapshot')
		})

		it('should have exactly 6 members', () => {
			const values = Object.values(SubjectNames)
			expect(values).toHaveLength(6)
		})
	})

	describe('IpcMessageCode', () => {
		it('should define Ok and Error codes', () => {
			expect(IpcMessageCode.Ok).toBe(200)
			expect(IpcMessageCode.Error).toBe(500)
		})
	})

	describe('ListenerResultType', () => {
		it('should define success and addr_in_use', () => {
			expect(ListenerResultType.Success).toBe('success')
			expect(ListenerResultType.AddrInUse).toBe('addr_in_use')
		})
	})

	describe('DataSource', () => {
		it('should define AGENT, INSPECTOR and IN_PROCESS', () => {
			expect(DataSource.AGENT).toBe('agent')
			expect(DataSource.INSPECTOR).toBe('inspector')
			expect(DataSource.IN_PROCESS).toBe('in_process')
		})
	})

	describe('scalar constants', () => {
		it('should have correct MITO_NODE value', () => {
			expect(MITO_NODE).toBe('_MITO_NODE_')
		})

		it('should have correct DEFAULT_TCP_PORT', () => {
			expect(DEFAULT_TCP_PORT).toBe(16666)
		})
	})
})
