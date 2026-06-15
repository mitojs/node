import { resolve } from 'node:path'
import { defineConfig, type LibraryFormats } from 'vite'
import dts from 'vite-plugin-dts'
import pkg from './package.json' with { type: 'json' }

const banner = `/* ${pkg.name} version:${pkg.version} */`
const footer = '/* follow me on Github! @cjinhuo */'

// CJS 格式下含 top-level await 的包必须外排
const cjsExternal = ['ink', 'yoga-layout', 'react-devtools-core']

const baseDir = import.meta.dirname
const buildTarget = process.env.BUILD_TARGET || 'esm' // esm | cjs | bin

const outputOptions = {
	banner,
	footer,
	exports: 'named' as const,
}

const configs = {
	esm: {
		entry: resolve(baseDir, 'src/index.ts'),
		formats: ['es'] as LibraryFormats[],
		fileName: () => 'index.esm.js',
		external: [] as string[],
		emptyOutDir: true,
		target: 'es2022',
		entryFileNames: 'index.esm.js',
		codeSplitting: false,
		plugins: [
			dts({
				tsconfigPath: resolve(baseDir, 'tsconfig.json'),
				outDir: 'dist',
				rollupTypes: true,
				copyDtsFiles: false,
			}),
		],
	},
	cjs: {
		entry: resolve(baseDir, 'src/index.ts'),
		formats: ['cjs'] as LibraryFormats[],
		fileName: () => 'index.cjs',
		external: cjsExternal,
		emptyOutDir: false,
		target: 'es2015',
		entryFileNames: 'index.cjs',
		codeSplitting: false,
		plugins: [],
	},
	bin: {
		entry: resolve(baseDir, 'src/bin.ts'),
		formats: ['es'] as LibraryFormats[],
		fileName: () => 'cli.mjs',
		external: ['./interactive-cli.mjs'],
		emptyOutDir: false,
		target: 'es2022',
		entryFileNames: 'cli.mjs',
		codeSplitting: false,
		plugins: [],
	},
	interactive: {
		entry: resolve(baseDir, 'src/interactive-cli.tsx'),
		formats: ['es'] as LibraryFormats[],
		fileName: () => 'interactive-cli.mjs',
		external: [] as string[],
		emptyOutDir: false,
		target: 'es2022',
		entryFileNames: 'interactive-cli.mjs',
		codeSplitting: false,
		plugins: [],
	},
}

const current = configs[buildTarget as keyof typeof configs]

export default defineConfig({
	build: {
		target: current.target,
		outDir: 'dist',
		sourcemap: true,
		minify: false,
		emptyOutDir: current.emptyOutDir,
		ssr: true,
		lib: {
			entry: current.entry,
			formats: current.formats,
			fileName: current.fileName,
		},
		rolldownOptions: {
			output: {
				...outputOptions,
				entryFileNames: current.entryFileNames,
				codeSplitting: current.codeSplitting,
			},
			external: current.external,
		},
	},
	ssr: {
		noExternal: true,
	},
	plugins: current.plugins,
})
