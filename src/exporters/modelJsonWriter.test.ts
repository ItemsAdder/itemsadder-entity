import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ensureGeometryOverlayMetadata, geometryOverlayDirectories } from './modelJsonWriter'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iae-v2-overlays-'))
try {
	const folders = ['alpha', 'beta'].map(name => path.join(temp, name, 'resourcepack', 'assets', 'test', 'models', 'entity', name))
	for (const folder of folders) {
		fs.mkdirSync(folder, { recursive: true })
		ensureGeometryOverlayMetadata(folder)
		ensureGeometryOverlayMetadata(folder)
	}
	const declarations = folders.map(folder => {
		const packRoot = folder.slice(0, folder.replace(/\\/g, '/').lastIndexOf('/assets/'))
		const entries = JSON.parse(fs.readFileSync(path.join(packRoot, 'pack.mcmeta'), 'utf8')).overlays.entries
		assert.equal(entries.length, 2, 'standalone export must declare both overlays exactly once')
		assert.deepEqual(entries.map((entry: any) => entry.directory), Object.values(geometryOverlayDirectories(folder)))
		return entries
	}).flat()
	const directories = declarations.map((entry: any) => entry.directory)
	assert.equal(new Set(directories).size, directories.length, 'separate V2 exports must have merge-safe overlay names')
	assert.ok(directories.every(directory => /^ia_overlay_v2_[0-9a-f]{64}_(?:1_21_6_plus|modern_atlas)$/.test(directory)))
	assert.ok(directories.every(directory => directory !== 'ia_overlay_1_21_6_plus' && directory !== 'ia_overlay_modern_atlas'))
	assert.equal(declarations.filter((entry: any) => entry.formats[0] === 75).length, 2)

	const shared = ['gamma', 'delta'].map(name => path.join(temp, 'shared', 'resourcepack', 'assets', 'test', 'models', 'entity', name))
	for (const folder of shared) { fs.mkdirSync(folder, { recursive: true }); ensureGeometryOverlayMetadata(folder) }
	const sharedEntries = JSON.parse(fs.readFileSync(path.join(temp, 'shared', 'resourcepack', 'pack.mcmeta'), 'utf8')).overlays.entries
	assert.equal(sharedEntries.length, 4, 'models in one standalone pack must retain every owned overlay')
	assert.equal(new Set(sharedEntries.map((entry: any) => entry.directory)).size, 4)
} finally {
	fs.rmSync(temp, { recursive: true, force: true })
}
