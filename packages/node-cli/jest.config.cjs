const baseConfig = require('../../jest.config.js')

module.exports = {
	...baseConfig,
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
}
