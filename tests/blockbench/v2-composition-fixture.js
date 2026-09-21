'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', '..')
const fixturePath = path.join(root, 'test-fixtures/v2/blockbench/v2_fixture.iaentitymodel')
const id = value => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const point = (channel, value) => ({ channel, time: 0, data_points: [{ x: value, y: value, z: value }] })
const keyframe = (channel, time, x, y = x, z = x) => ({ channel, time, data_points: [{ x, y, z }] })

function fullAnimation() {
	const animators = {}
	for (const [uuid, name] of [[10, 'root'], [11, 'middle'], [12, 'tip']]) {
		animators[id(uuid)] = { type: 'bone', name, keyframes: [point('position', 0), point('rotation', 0), point('scale', 1)] }
	}
	return { name: 'full', uuid: id(23), loop: 'hold', length: 1, layer: 'full', priority: 20, animators }
}

function walkAnimation() {
	return {
		name: 'walk', uuid: id(24), loop: 'loop', length: 1, animType: 'walk', strideDistance: 0.8,
		animators: {
			[id(10)]: { type: 'bone', name: 'root', keyframes: [
				keyframe('rotation', 0, -12, 5, -4), keyframe('rotation', .25, 18, -9, 7),
				keyframe('rotation', .5, -12, 5, -4), keyframe('rotation', .75, -24, 11, -8),
				keyframe('rotation', 1, -12, 5, -4),
			] },
			[id(12)]: { type: 'bone', name: 'tip', keyframes: [
				keyframe('rotation', 0, 22, -8, 13), keyframe('rotation', .25, -31, 16, -19),
				keyframe('rotation', .5, 22, -8, 13), keyframe('rotation', .75, 39, -21, 24),
				keyframe('rotation', 1, 22, -8, 13),
			] },
		},
	}
}

function walkActionAnimation() {
	return {
		name: 'walk_action', uuid: id(25), loop: 'hold', length: 1,
		layer: 'upper_body', priority: 5, blendIn: .2, blendOut: .3,
		animators: { [id(10)]: { type: 'bone', name: 'root', keyframes: [
			keyframe('rotation', 0, 55, -20, 15), keyframe('rotation', 1, 55, -20, 15),
		] } },
	}
}

async function waitFor(file) {
	const deadline = Date.now() + 30_000
	while (!fs.existsSync(file) || !fs.statSync(file).size) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`)
		await new Promise(resolve => setTimeout(resolve, 25))
	}
}

function decode(bytes) {
	if (bytes.subarray(0, 4).toString() !== 'IAE2') throw new Error('Composition fixture did not export IAE2')
	const jsonBytes = bytes.readUInt32LE(8)
	return JSON.parse(bytes.subarray(16, 16 + jsonBytes))
}

async function run(page, { output }) {
	const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
	fixture.animations.push(fullAnimation(), walkAnimation(), walkActionAnimation())
	fixture.textures[0].path = path.join(root, 'src/assets/mc-build.png')
	fixture.textures[1].path = path.join(root, 'src/assets/transparent.png')
	fixture.textures.forEach(texture => { texture.saved = true })
	const projectPath = path.join(output, 'contents/test/v2_fixture.iaentitymodel')
	fs.mkdirSync(path.dirname(projectPath), { recursive: true })
	fs.writeFileSync(projectPath, JSON.stringify(fixture, null, 2) + '\n')
	const metadataPath = path.join(output, 'contents/test/resourcepack/assets/test/models/entity/v2_fixture/.metadata')

	await page.evaluate(async ({ fixture, projectPath }) => {
		Codecs.iaentitymodel.load(fixture, { path: projectPath })
		Canvas.updateAll()
		IAENTITY.store.getStore('exporters').get('vanillaAnimationExporter')()
		const deadline = Date.now() + 30_000
		while (IAENTITY.exportInProgress && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
		if (IAENTITY.exportInProgress) throw new Error('Timed out waiting for composition export')
	}, { fixture, projectPath })
	await waitFor(metadataPath)
	const first = fs.readFileSync(metadataPath)
	await page.evaluate(async () => {
		IAENTITY.store.getStore('exporters').get('vanillaAnimationExporter')()
		const deadline = Date.now() + 30_000
		while (IAENTITY.exportInProgress && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
	})
	const second = fs.readFileSync(metadataPath)
	if (!first.equals(second)) throw new Error('Composition export is not byte-deterministic')
	const metadata = decode(first)
	const animation = name => metadata.animations.find(value => value.name === name)
	if (JSON.stringify(animation('neutral')?.channelMasks) !== JSON.stringify([[0, 2]])) throw new Error('Explicit constant rotation lost ownership')
	if (JSON.stringify(animation('held')?.channelMasks) !== JSON.stringify([[0, 2], [1, 5], [2, 2]])) throw new Error('Ordinary sparse masks differ')
	if (JSON.stringify(animation('override')?.channelMasks) !== JSON.stringify([[0, 2]])) throw new Error('Generated rest tracks created false ownership')
	if (JSON.stringify(animation('full')?.channelMasks) !== JSON.stringify([[0, 7], [1, 7], [2, 7]])) throw new Error('Full-body masks differ')
	if (JSON.stringify(animation('walk')?.channelMasks) !== JSON.stringify([[0, 2], [2, 2]])) throw new Error('Walk masks differ')
	if (animation('walk')?.animType !== 'walk' || animation('walk')?.strideDistance !== 0.8) throw new Error('Walk locomotion contract differs')
	if (JSON.stringify(animation('walk_action')?.channelMasks) !== JSON.stringify([[0, 2]])) throw new Error('Walk action masks differ')
	if (metadata.animations.some(value => 'affectedBones' in value)) throw new Error('New export retained the coarse bone mask')
	return { output, metadataPath, bytes: first.length, masks: Object.fromEntries(metadata.animations.map(value => [value.name, value.channelMasks])) }
}

module.exports = { run }
