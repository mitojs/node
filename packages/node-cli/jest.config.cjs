/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	...require('../../jest.config.js'),
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
}
