'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const textureSource = path.join(__dirname, 'assets/pig-1.21.1.png')
const limbFactor = Math.fround(.6662)
const limbAmplitude = Math.fround(1.4)
const id = value => `30000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const degrees = radians => radians * 180 / Math.PI
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

// Minecraft model space is Y-down around a 24-pixel entity origin. The V2 item
// display pipeline mirrors Blockbench X, so points/pivots map as (-x, 24-y, z).
function faces(from, to, [u, v]) {
	const [w, h, d] = to.map((value, axis) => value - from[axis])
	const rectangles = {
		east: [0, d, d, d + h], west: [d + w, d, d * 2 + w, d + h],
		up: [d + w, d, d, 0], down: [d + w * 2, 0, d + w, d],
		south: [d * 2 + w, d, d * 2 + w * 2, d + h], north: [d, d, d + w, d + h],
	}
	return Object.fromEntries(Object.entries(rectangles).map(([name, uv]) =>
		[name, { uv: uv.map((value, axis) => value + (axis % 2 ? v : u)), texture: 0 }]))
}

const cube = (name, uuid, from, to, origin, uv) =>
	({ name, uuid: id(uuid), from, to, origin, box_uv: false, faces: faces(from, to, uv) })
const group = (name, uuid, origin, children, extra = {}) =>
	({ name, uuid: id(uuid), origin, rotation: [0, 0, 0], ...extra, children: children.map(id) })
const rotation = (time, x, y = 0, z = 0) =>
	({ channel: 'rotation', time, interpolation: 'catmullrom', data_points: [{ x, y, z }] })
const animator = (name, keyframes) => ({ type: 'bone', name, keyframes })

function model(namespace) {
	const elements = [
		cube('head', 1, [-4, 8, -14], [4, 16, -6], [0, 12, -6], [0, 0]),
		cube('snout', 2, [-2, 9, -15], [2, 12, -14], [0, 12, -6], [16, 16]),
		cube('body', 3, [-5, 7, -5], [5, 23, 3], [0, 13, 2], [28, 8]),
		cube('right_hind_leg', 4, [1, 0, 5], [5, 6, 9], [3, 6, 7], [0, 16]),
		cube('left_hind_leg', 5, [-5, 0, 5], [-1, 6, 9], [-3, 6, 7], [0, 16]),
		cube('right_front_leg', 6, [1, 0, -7], [5, 6, -3], [3, 6, -5], [0, 16]),
		cube('left_front_leg', 7, [-5, 0, -7], [-1, 6, -3], [-3, 6, -5], [0, 16]),
	]
	const children = [
		group('head', 11, [0, 12, -6], [1, 2], { boneType: 'head', maxHeadRotX: 90, maxHeadRotY: 75 }),
		group('body', 12, [0, 13, 2], [3], { rotation: [-90, 0, 0] }),
		group('right_hind_leg', 13, [3, 6, 7], [4]), group('left_hind_leg', 14, [-3, 6, 7], [5]),
		group('right_front_leg', 15, [3, 6, -5], [6]), group('left_front_leg', 16, [-3, 6, -5], [7]),
	]
	const tracks = Object.fromEntries([13, 14, 15, 16].map(uuid => [id(uuid), []]))
	for (let tick = 0; tick <= 40; tick++) {
		const time = tick / 20
		const angle = degrees(limbAmplitude * Math.cos(time * Math.PI))
		tracks[id(13)].push(rotation(time, -angle))
		tracks[id(14)].push(rotation(time, angle))
		tracks[id(15)].push(rotation(time, angle))
		tracks[id(16)].push(rotation(time, -angle))
	}
	return {
		meta: { uuid: id(99), format_version: '1.0', model_format: 'ia/iaentitymodel', box_uv: false,
			settings: { iaentitymodel: { namespace, projectName: 'pig_v2', entityFormat: 'v2' } } },
		resolution: { width: 64, height: 32 }, elements,
		outliner: [{ name: 'root', uuid: id(10), origin: [0, 0, 0], rotation: [0, 0, 0], children }],
		textures: [{ id: '0', uuid: id(30), name: 'pig.png', source: `data:image/png;base64,${fs.readFileSync(textureSource).toString('base64')}`, folder: '', namespace: '', saved: true, uv_width: 64, uv_height: 32 }],
		animations: [
			{ name: 'idle', uuid: id(20), loop: 'hold', length: 1, animType: 'idle', animators: { [id(10)]: animator('root', [rotation(0, 0), rotation(1, 0)]) } },
			{ name: 'walk', uuid: id(21), loop: 'loop', length: 2, animType: 'walk', strideDistance: 2 * Math.PI / (limbFactor * 4), animators: {
				[id(13)]: animator('right_hind_leg', tracks[id(13)]), [id(14)]: animator('left_hind_leg', tracks[id(14)]),
				[id(15)]: animator('right_front_leg', tracks[id(15)]), [id(16)]: animator('left_front_leg', tracks[id(16)]),
			} },
		],
	}
}

async function waitFor(file) {
	const deadline = Date.now() + 30_000
	while (!fs.existsSync(file) || !fs.statSync(file).size) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`)
		await new Promise(resolve => setTimeout(resolve, 25))
	}
}

async function runPig(page, { outputRoot, namespace = 'test', preserveResourcepack = false }) {
	const fixture = model(namespace)
	const projectPath = path.join(outputRoot, 'contents', namespace, 'pig_v2.iaentitymodel')
	const contentRoot = path.dirname(projectPath)
	const modelRoot = path.join(contentRoot, 'resourcepack', 'assets', namespace, 'models', 'entity', 'pig_v2')
	const metadataPath = path.join(modelRoot, '.metadata')
	const yamlPath = path.join(contentRoot, 'custom_entity_pig_v2.yml')
	fs.mkdirSync(contentRoot, { recursive: true })
	fs.writeFileSync(projectPath, JSON.stringify(fixture, null, 2) + '\n')
	fs.writeFileSync(yamlPath, `info:\n  namespace: ${namespace}\nentities:\n  pig_v2:\n    model_folder: entity/pig_v2\n    type: PIG\n    can_sun_burn: false\n`)

	const oracle = await page.evaluate(({ fixture, projectPath }) => {
		Codecs.iaentitymodel.load(fixture, { path: projectPath })
		Modes.options.animate.select(); Canvas.updateAll()
		const walk = Animation.all.find(animation => animation.name === 'walk'); walk.select()
		const samples = []
		for (let step = 0; step <= 80; step++) {
			const time = step / 40
			Timeline.time = time; Animator.preview()
			for (const group of Group.all) group.mesh.updateWorldMatrix(true, true)
			samples.push({ time, bones: Group.all.map(bone => ({ name: bone.name, rotation: [...bone.rotation],
				previewRotation: [bone.mesh.rotation.x, bone.mesh.rotation.y, bone.mesh.rotation.z].map(value => value * 180 / Math.PI),
				matrix: Array.from(bone.mesh.matrixWorld.elements) })) })
		}
		return samples
	}, { fixture, projectPath })
	let curveError = 0, worstCurveSample
	for (const sample of oracle) {
		const expected = degrees(limbAmplitude * Math.cos(sample.time * Math.PI))
		const rotations = Object.fromEntries(sample.bones.map(bone => [bone.name, bone.previewRotation[0]]))
		const error = Math.max(Math.abs(rotations.right_hind_leg + expected), Math.abs(rotations.left_hind_leg - expected),
			Math.abs(rotations.right_front_leg - expected), Math.abs(rotations.left_front_leg + expected))
		if (error > curveError) { curveError = error; worstCurveSample = { time: sample.time, expected, rotations } }
	}
	assert.ok(curveError < .02, `Pig between-keyframe cosine error ${curveError} degrees: ${JSON.stringify(worstCurveSample)}`)
	fs.writeFileSync(path.join(outputRoot, 'oracle.json'), JSON.stringify({ schema: 'pig-1.21.1-oracle-v1', namespace, samples: oracle }) + '\n')

	async function exportOnce() {
		if (!preserveResourcepack) fs.rmSync(path.join(contentRoot, 'resourcepack'), { recursive: true, force: true })
		await page.evaluate(async () => {
			IAENTITY.store.getStore('exporters').get('vanillaAnimationExporter')()
			const deadline = Date.now() + 30_000
			while (IAENTITY.exportInProgress && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
			if (IAENTITY.exportInProgress) throw new Error('Timed out waiting for pig V2 export')
		})
		await waitFor(metadataPath)
		return fs.readFileSync(metadataPath)
	}
	const first = await exportOnce(), second = await exportOnce()
	assert.ok(first.equals(second), 'Pig metadata export is nondeterministic')
	assert.equal(first.subarray(0, 4).toString(), 'IAE2')
	const metadata = JSON.parse(first.subarray(16, 16 + first.readUInt32LE(8)))
	assert.deepEqual(metadata.animations.map(animation => [animation.name, animation.animType]), [['idle', 'idle'], ['walk', 'walk']])
	assert.ok(Math.abs(metadata.animations[1].strideDistance - 2 * Math.PI / (limbFactor * 4)) < 1e-12)
	assert.equal(metadata.bones.find(bone => bone.name === 'head').boneType, 'head')
	assert.equal(Object.keys(metadata.textures).length, 1)
	assert.equal(Object.keys(metadata.textures)[0], hash(fs.readFileSync(textureSource)))
	fs.writeFileSync(path.join(outputRoot, 'conversion-report.json'), JSON.stringify({
		schema: 'pig-1.21.1-conversion-v1', namespace, projectPath, metadataPath,
		sources: { namedClientSha256: 'b60e67729c6ce9eafd544ffb3e47aaf2663811463e71c990a0da47a74294edd8', textureSha256: hash(fs.readFileSync(textureSource)) },
		coordinateConversion: 'Blockbench (-x, 24-y, z); X/Z Euler signs invert', curveSamples: 81, maxCurveErrorDegrees: curveError,
		coverage: ['adult unsaddled geometry', 'UVs', 'head yaw/pitch role', 'four-leg phase/amplitude/cadence', 'loop seam'],
	}, null, 2) + '\n')
	return { id: 'pig_v2', outputRoot, projectPath, metadataPath, curveError, bones: metadata.bones.length }
}

module.exports = { model, runPig }
