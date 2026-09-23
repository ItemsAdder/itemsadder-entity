'use strict'

const fs = require('fs')
const path = require('path')

const textureSource = path.join(__dirname, '../../projects/native-v2/zombie_v2/source/zombie.png')
const ageXPeriod = 2 * Math.PI / Math.fround(.067)
const ageZPeriod = 2 * Math.PI / Math.fround(.09)

const fixtureSource = path.join(__dirname, '../../projects/native-v2/zombie_v2/source/zombie_v2.iaentitymodel')

async function waitFor(files) {
	const deadline = Date.now() + 30_000
	while (!files.every(file => fs.existsSync(file) && fs.statSync(file).size)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${files.join(', ')}`)
		await new Promise(resolve => setTimeout(resolve, 25))
	}
}

async function run(page, { output }) {
	const fixture = JSON.parse(fs.readFileSync(fixtureSource, 'utf8'))
	const projectPath = path.join(output, 'contents/test/zombie_v2.iaentitymodel')
	fs.mkdirSync(path.dirname(projectPath), { recursive: true })
	fs.writeFileSync(projectPath, JSON.stringify(fixture, null, 2) + '\n')
	const oracle = await page.evaluate(({ fixture, projectPath }) => {
		Codecs.iaentitymodel.load(fixture, { path: projectPath })
		Modes.options.animate.select(); Canvas.updateAll()
		const samples = {}
		for (const animationName of ['idle', 'walk', 'hurt', 'death']) {
			const animation = Animation.all.find(value => value.name === animationName)
			animation.select()
			samples[animationName] = []
			for (const time of [0, animation.length / 4, animation.length / 2, animation.length * .75, animation.length]) {
				Timeline.time = time; Animator.preview()
				samples[animationName].push({ time, bones: Group.all.map(bone => ({ name: bone.name, matrix: Array.from(bone.mesh.matrixWorld.elements) })) })
			}
		}
		return samples
	}, { fixture, projectPath })
	fs.writeFileSync(path.join(output, 'oracle.json'), JSON.stringify({ schema: 'zombie-parity-v1', samples: oracle }, null, 2) + '\n')
	const modelRoot = path.join(output, 'contents/test/resourcepack/assets/test/models/entity/zombie_v2')
	const metadataPath = path.join(modelRoot, '.metadata')
	fs.rmSync(metadataPath, { force: true })
	fs.rmSync(path.join(modelRoot, 'profiles'), { recursive: true, force: true })
	await page.evaluate(async () => {
		IAENTITY.store.getStore('exporters').get('vanillaAnimationExporter')()
		const deadline = Date.now() + 30_000
		while (IAENTITY.exportInProgress && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
		if (IAENTITY.exportInProgress) throw new Error('Timed out waiting for zombie V2 export')
	})
	const required = [metadataPath, ...['head_content', 'body', 'right_arm', 'left_arm', 'right_leg', 'left_leg']
		.map(name => path.join(modelRoot, `profiles/compatible/${name}/0.json`))]
	await waitFor(required)
	const bytes = fs.readFileSync(metadataPath)
	if (bytes.subarray(0, 4).toString() !== 'IAE2') throw new Error('Zombie fixture did not export IAE2')
	const jsonBytes = bytes.readUInt32LE(8)
	const metadata = JSON.parse(bytes.subarray(16, 16 + jsonBytes))
	const bones = new Map(metadata.bones.map(bone => [bone.name, bone]))
	if (bones.size !== 8 || bones.get('root')?.boneType !== 'locator' || bones.get('head')?.boneType !== 'head'
		|| JSON.stringify(bones.get('head_content')?.parents) !== JSON.stringify(['head', 'root'])) throw new Error('Zombie hierarchy/bone types changed')
	for (const name of ['idle', 'walk', 'zombie_arm_age_zy', 'zombie_arm_attack_y', 'zombie_arm_age_x', 'zombie_arm_aggressive', 'zombie_arm_attack_x', 'hurt', 'death']) if (!metadata.animations.some(animation => animation.name === name)) throw new Error(`Missing ${name} animation`)
	for (const type of ['idle', 'walk']) if (!metadata.animations.some(animation => animation.animType === type)) throw new Error(`Missing ${type} semantic animation`)
	const drivers = Object.fromEntries(metadata.animations.filter(animation => animation.semanticDriver).map(animation => [animation.name, animation.semanticDriver]))
	if (JSON.stringify(drivers) !== JSON.stringify({ zombie_arm_age_zy: 'age', zombie_arm_attack_y: 'attack_progress', zombie_arm_age_x: 'age', zombie_arm_aggressive: 'aggressive', zombie_arm_attack_x: 'attack_progress' })) throw new Error('Zombie semantic drivers changed')
	const periods = Object.fromEntries(metadata.animations.filter(animation => animation.semanticPeriod).map(animation => [animation.name, animation.semanticPeriod]))
	if (Math.abs(periods.zombie_arm_age_zy - ageZPeriod) > 1e-12 || Math.abs(periods.zombie_arm_age_x - ageXPeriod) > 1e-12
		|| Object.keys(periods).length !== 2) throw new Error('Zombie semantic periods changed')
	const walkAnimation = metadata.animations.find(animation => animation.name === 'walk')
	if (Math.abs(walkAnimation.strideDistance - 2 * Math.PI / (0.6662 * 4)) > 1e-12) throw new Error('Zombie locomotion stride contract changed')
	if (!metadata.animations.find(animation => animation.name === 'hurt').effects.tint) throw new Error('Zombie hurt tint was not exported')
	const embedded = Object.values(metadata.textures)
	if (embedded.length !== 1 || !Buffer.from(embedded[0], 'base64').equals(fs.readFileSync(textureSource)))
		throw new Error('Vanilla zombie texture bytes changed or were not embedded')
	let checkedFaces = 0
	for (const element of fixture.elements) {
		const name = element.name === 'head_cube' ? 'head_content' : element.name.replace('_cube', '')
		const exported = JSON.parse(fs.readFileSync(path.join(modelRoot, `profiles/compatible/${name}/0.json`)))
		for (const [direction, face] of Object.entries(element.faces)) {
			const wanted = face.uv.map(value => value / 4)
			if (JSON.stringify(exported.elements[0].faces[direction].uv) !== JSON.stringify(wanted))
				throw new Error(`Vanilla UV mismatch: ${name}/${direction}`)
			checkedFaces++
		}
	}
	return { bones: bones.size, animations: metadata.animations.map(animation => animation.name), vanillaTextureExact: true, checkedFaces, output }
}

module.exports = { run }
