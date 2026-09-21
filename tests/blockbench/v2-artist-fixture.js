'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function hash(bytes) {
	return crypto.createHash('sha256').update(bytes).digest('hex')
}

function filesBelow(root) {
	const result = new Map()
	function visit(folder) {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const file = path.join(folder, entry.name)
			if (entry.isDirectory()) visit(file)
			else result.set(path.relative(root, file).replace(/\\/g, '/'), fs.readFileSync(file))
		}
	}
	if (fs.existsSync(root)) visit(root)
	return result
}

function decodeMetadata(bytes) {
	if (bytes.subarray(0, 4).toString() !== 'IAE2' || bytes.readUInt16LE(4) !== 2) throw new Error('Invalid artist V2 metadata')
	const size = bytes.readUInt32LE(8)
	return JSON.parse(bytes.subarray(16, 16 + size).toString('utf8'))
}

function animationInventory(model) {
	return (model.animations || []).map(animation => {
		const channels = {}
		const interpolation = {}
		let points = 0
		for (const animator of Object.values(animation.animators || {})) for (const keyframe of animator.keyframes || []) {
			channels[keyframe.channel] = (channels[keyframe.channel] || 0) + 1
			const mode = keyframe.interpolation || 'linear'
			interpolation[mode] = (interpolation[mode] || 0) + 1
			points += (keyframe.data_points || []).length
		}
		return { name: animation.name, length: animation.length || 0, loop: animation.loop || 'once', channels, interpolation, points }
	})
}

function embeddedTextureHashes(model) {
	return (model.textures || []).map(texture => {
		if (typeof texture.source !== 'string' || !texture.source.startsWith('data:image/png;base64,')) throw new Error(`Artist texture ${texture.name} is not embedded PNG data`)
		return hash(Buffer.from(texture.source.slice(texture.source.indexOf(',') + 1), 'base64'))
	}).sort()
}

async function waitForFile(file) {
	const deadline = Date.now() + 30_000
	while (!fs.existsSync(file) || fs.statSync(file).size === 0) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`)
		await new Promise(resolve => setTimeout(resolve, 25))
	}
}

async function runArtist(page, { sourcePath, outputRoot, id, namespace = 'test', preserveResourcepack = false }) {
	const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
	const projectPath = path.join(outputRoot, 'contents', namespace, `${id}.iaentitymodel`)
	const contentRoot = path.dirname(projectPath)
	const resourcepackRoot = path.join(contentRoot, 'resourcepack')
	const metadataPath = path.join(resourcepackRoot, 'assets', namespace, 'models', 'entity', id, '.metadata')
	const yamlPath = path.join(contentRoot, `custom_entity_${id}.yml`)
	fs.mkdirSync(contentRoot, { recursive: true })
	// The immutable original is opened with Blockbench's native project codec from this task-owned copy.
	fs.writeFileSync(projectPath, JSON.stringify(source, null, 2) + '\n')

	const result = await page.evaluate(async ({ model, projectPath, id, namespace }) => {
		const codec = Codecs.iaentitymodel
		Codecs.project.load(model, { path: projectPath, no_file: true })
		if (Cube.all.length !== model.elements.filter(element => element.type === 'cube').length) throw new Error('Native Blockbench load changed artist cube count')
		if (Group.all.length !== model.groups.length) throw new Error(`Native Blockbench load changed artist bone count: ${Group.all.length}/${model.groups.length}`)
		if (Texture.all.length !== model.textures.length) throw new Error('Native Blockbench load changed artist texture count')
		if (Animation.all.length !== model.animations.length) throw new Error('Native Blockbench load changed artist animation count')
		Object.assign(IAENTITY.settings.iaentitymodel, { namespace, projectName: id, entityFormat: 'v2' })
		Formats['ia/iaentitymodel'].convertTo()
		Object.assign(IAENTITY.settings.iaentitymodel, { namespace, projectName: id, entityFormat: 'v2' })
		IAENTITY.store.set('states', { default: {} })
		Project.name = id
		Project.geometry_name = id
		codec.afterSave(projectPath)
		if (Format.id !== 'ia/iaentitymodel') throw new Error('Artist project did not convert to ItemsAdder format')
		if (IAENTITY.settings.iaentitymodel.entityFormat !== 'v2') throw new Error('Artist project did not select V2')
		if (Cube.all.length !== model.elements.filter(element => element.type === 'cube').length) throw new Error('Artist cube count changed during conversion')
		if (Group.all.length !== model.groups.length) throw new Error('Artist bone count changed during conversion')
		if (Texture.all.length !== model.textures.length) throw new Error('Artist texture count changed during conversion')
		if (Animation.all.length !== model.animations.length) throw new Error('Artist animation count changed during conversion')
		const safe = name => name.toLowerCase().replace(/[^\w\d._]+/g, '_')
		const samples = {}
		Modes.options.animate.select()
		for (const animation of Animation.all) {
			animation.select()
			const frames = []
			for (let frame = 0; frame <= Math.ceil(animation.length * 20); frame++) {
				const time = Math.min(frame / 20, animation.length)
				Timeline.time = time
				Animator.preview()
				for (const group of Group.all) group.mesh.updateWorldMatrix(true, true)
				frames.push({
					time,
					bones: Group.all.filter(group => group.export !== false).map(group => ({
						name: safe(group.name),
						sourceName: group.name,
						localMatrix: Array.from(group.mesh.matrix.elements),
						worldMatrix: Array.from(group.mesh.matrixWorld.elements),
						cubes: group.children.filter(child => child instanceof Cube).map(cube => ({
							name: cube.name,
							matrixWorld: Array.from(cube.mesh.matrixWorld.elements),
							vertices: Array.from(cube.mesh.geometry.attributes.position.array),
						})),
					})),
				})
			}
			samples[animation.name] = frames
		}
		const project = codec.compile({ savePath: projectPath })
		return {
			project,
			oracle: {
				schema: 'blockbench-artist-oracle-v1', namespace, project: id,
				source: { cubes: Cube.all.length, bones: Group.all.length, textures: Texture.all.length, animations: Animation.all.map(animation => animation.name) },
				samples,
			},
		}
	}, { model: source, projectPath, id, namespace })
	fs.writeFileSync(projectPath, result.project.endsWith('\n') ? result.project : `${result.project}\n`)
	const compiled = JSON.parse(result.project)
	assert.deepEqual(animationInventory(compiled), animationInventory(source), `${id} animation channels/interpolation changed during conversion`)
	assert.deepEqual(embeddedTextureHashes(compiled), embeddedTextureHashes(source), `${id} embedded project textures changed`)

	async function exportOnce() {
		if (!preserveResourcepack) fs.rmSync(resourcepackRoot, { recursive: true, force: true })
		fs.rmSync(yamlPath, { force: true })
		await page.evaluate(async () => {
			IAENTITY.store.getStore('exporters').get('vanillaAnimationExporter')()
			await new Promise(resolve => setTimeout(resolve, 0))
			const deadline = Date.now() + 45_000
			while (IAENTITY.exportInProgress && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
			if (IAENTITY.exportInProgress) throw new Error('Timed out waiting for artist V2 export')
		})
		await waitForFile(metadataPath)
		await waitForFile(yamlPath)
		return filesBelow(contentRoot)
	}
	const first = await exportOnce()
	const second = await exportOnce()
	assert.deepEqual([...second.keys()], [...first.keys()], `${id} export file list is nondeterministic`)
	for (const [name, bytes] of first) assert(second.get(name).equals(bytes), `${id} export is nondeterministic: ${name}`)

	const metadata = decodeMetadata(first.get(path.relative(contentRoot, metadataPath).replace(/\\/g, '/')))
	const savedProject = JSON.parse(result.project)
	assert.equal(metadata.transformSpace, 'local')
	assert.deepEqual(metadata.animations.map(animation => animation.name), source.animations.map(animation => animation.name))
	if (id === 'goofy_goblin') {
		const savedWalk = savedProject.animations.find(animation => animation.name === 'walk')
		assert.equal(savedWalk?.locomotionMode, 'elapsed')
		assert.equal(savedWalk?.restOnStop, 'true')
		const semantics = Object.fromEntries(metadata.animations.map(animation => [animation.name, {
			animType: animation.animType, locomotionMode: animation.locomotionMode, restOnStop: animation.restOnStop,
		}]))
		assert.deepEqual(semantics, {
			pose: { animType: 'other', locomotionMode: undefined, restOnStop: undefined },
			walk: { animType: 'walk', locomotionMode: 'elapsed', restOnStop: true },
		})
	}
	for (const animation of metadata.animations) {
		const expectedFrames = Math.ceil(animation.length * 20) + 1
		for (const track of Object.values(animation.tracks)) assert.equal(track.length, expectedFrames, `${id}/${animation.name} frame count`)
	}
	assert.deepEqual(Object.keys(metadata.geometryProfiles), ['compatible', 'single_axis_45', 'unrestricted'])
	const owner = hash(Buffer.from(`${namespace}:entity/${id}`))
	for (const profile of Object.keys(metadata.geometryProfiles)) {
		const overlay = profile === 'compatible' ? '' : `ia_overlay_v2_${owner}_${profile === 'single_axis_45' ? '1_21_6_plus' : 'modern_atlas'}/`
		const prefix = `resourcepack/${overlay}assets/${namespace}/models/entity/${id}/profiles/${profile}/`
		if (![...first.keys()].some(name => name.startsWith(prefix) && name.endsWith('.json'))) throw new Error(`${id} has no ${profile} profile models`)
	}
	const sourceTextureHashes = embeddedTextureHashes(source)
	if (id === 'armored_grub') {
		const sourceFace = source.elements[0].faces.north
		const texture = source.textures[sourceFace.texture]
		assert.notEqual(source.resolution.width, texture.uv_width, 'Armored grub fixture must exercise per-texture UV resolution')
		const expected = sourceFace.uv.map((value, axis) => value * 16 / (axis % 2 ? texture.uv_height : texture.uv_width))
		const exportedUvs = [...first].filter(([name]) => name.includes(`/models/entity/${id}/profiles/compatible/`) && name.endsWith('.json'))
			.flatMap(([, bytes]) => JSON.parse(bytes.toString('utf8')).elements || [])
			.flatMap(element => Object.values(element.faces || {}).map(face => face.uv))
		assert.ok(exportedUvs.some(uv => uv?.length === expected.length && uv.every((value, index) => Math.abs(value - expected[index]) < 1e-9)),
			'Armored grub export did not normalize face UVs with its 128x128 texture canvas')
	}
	const exportedTextureFiles = [...first].filter(([name]) => name.startsWith(`resourcepack/assets/${namespace}/textures/ia_v2/`)
		&& name.endsWith('.png') && sourceTextureHashes.includes(path.basename(name, '.png')))
	const exportedTextureHashes = exportedTextureFiles.map(([, bytes]) => hash(bytes)).sort()
	if (!exportedTextureHashes.length || exportedTextureHashes.some(value => !sourceTextureHashes.includes(value))) throw new Error(`${id} exported texture bytes changed`)
	assert.deepEqual(Object.keys(metadata.textures || {}).sort(), exportedTextureHashes, `${id} embedded texture table differs from sidecars`)
	for (const [name, bytes] of exportedTextureFiles) {
		const digest = path.basename(name, '.png')
		assert.equal(digest, hash(bytes), `${id} sidecar filename is not its content digest`)
		assert.ok(Buffer.from(metadata.textures[digest], 'base64').equals(bytes), `${id} embedded texture differs from sidecar`)
	}
	for (const [name, bytes] of first) if (name.endsWith('.json') && name.includes(`/models/entity/${id}/`)) {
		const model = JSON.parse(bytes.toString('utf8'))
		for (const reference of Object.values(model.textures || {})) if (typeof reference === 'string' && reference.startsWith(`${namespace}:`)) {
			if (!new RegExp(`^${namespace}:ia_v2/[0-9a-f]{64}$`).test(reference) || !(reference.slice(`${namespace}:ia_v2/`.length) in metadata.textures)) throw new Error(`${id} model has non-embedded texture reference: ${reference}`)
		}
	}
	const finite = Object.values(result.oracle.samples).every(frames => frames.every(frame => frame.bones.every(bone => [...bone.localMatrix, ...bone.worldMatrix, ...bone.cubes.flatMap(cube => [...cube.matrixWorld, ...cube.vertices])].every(Number.isFinite))))
	if (!finite) throw new Error(`${id} editor oracle contains non-finite values`)
	const oraclePath = path.join(outputRoot, 'oracle.json')
	const reportPath = path.join(outputRoot, 'conversion-report.json')
	fs.writeFileSync(oraclePath, JSON.stringify(result.oracle) + '\n')
	fs.writeFileSync(reportPath, JSON.stringify({
		schema: 'blockbench-artist-conversion-v1', sourcePath, sourceSha256: hash(fs.readFileSync(sourcePath)), projectPath, namespace, id,
		preserved: { cubes: source.elements.length, bones: source.groups.length, textures: source.textures.length, animations: animationInventory(source) },
		unsupportedSourceEditorMetadata: Object.keys(source).filter(key => ['multi_file_ruleset', 'timeline_setups', 'unhandled_root_fields', 'variable_placeholder_buttons'].includes(key)),
		exportFiles: first.size, metadata: path.relative(outputRoot, metadataPath).replace(/\\/g, '/'), oracle: 'oracle.json',
	}, null, 2) + '\n')
	return { id, outputRoot, projectPath, oraclePath, reportPath, files: first.size, bones: metadata.bones.length, animations: metadata.animations.map(animation => animation.name) }
}

module.exports = { runArtist }
