import { defineConfig } from 'tsup'

// ESM + CommonJS for Node and bundlers, and a script-tag build (global `ShinsekaiSnowflake`), like the original
export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs', 'iife'],
	globalName: 'ShinsekaiSnowflake',
	target: 'es2022',
	dts: true,
	sourcemap: true,
	clean: true,
	minify: false
})
