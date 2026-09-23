'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const textureSource = path.join(__dirname, '../../projects/native-v2/pig_v2/source/pig-1.21.1.png')
const limbFactor = Math.fround(.6662)
const limbAmplitude = Math.fround(1.4)
const degrees = radians => radians * 180 / Math.PI
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const fixtureSource = path.join(__dirname, '../../projects/native-v2/pig_v2/source/pig_v2.iaentitymodel')

async function waitFor(file) {
	const deadline = Date.now() + 30_000
	while (!fs.existsSync(file) || !fs.statSync(file).size) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`)
		await new Promise(resolve => setTimeout(resolve, 25))
	}
}

async function runPig(page, { outputRoot, namespace = 'test', preserveResourcepack = false }) {
	const fixture = JSON.parse(fs.readFileSync(fixtureSource, 'utf8'))
	fixture.meta.settings.iaentitymodel.namespace = namespace
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

module.exports = { runPig }
