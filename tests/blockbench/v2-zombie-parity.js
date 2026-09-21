'use strict'

const fs = require('fs')
const path = require('path')

const textureSource = path.join(__dirname, 'assets/zombie.png')
const ageXPeriod = 2 * Math.PI / Math.fround(.067)
const ageZPeriod = 2 * Math.PI / Math.fround(.09)

const id = value => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`
// Vanilla box unwrap, stored as explicit faces because the IA codec uses per-face UVs.
function faces(from, to, [u, v], mirror) {
	const [w, h, d] = to.map((value, axis) => value - from[axis])
	const rectangles = {
		east: [0, d, d, d + h], west: [d + w, d, d * 2 + w, d + h],
		up: [d + w, d, d, 0], down: [d + w * 2, 0, d + w, d],
		south: [d * 2 + w, d, d * 2 + w * 2, d + h], north: [d, d, d + w, d + h],
	}
	if (mirror) {
		for (const uv of Object.values(rectangles)) [uv[0], uv[2]] = [uv[2], uv[0]]
		;[rectangles.east, rectangles.west] = [rectangles.west, rectangles.east]
	}
	return Object.fromEntries(Object.entries(rectangles).map(([name, uv]) =>
		[name, { uv: uv.map((value, axis) => value + (axis % 2 ? v : u)), texture: 0 }]))
}
const cube = (name, uuid, from, to, origin, uv_offset, mirror_uv = false) =>
	({ name, uuid: id(uuid), from, to, origin, box_uv: false, faces: faces(from, to, uv_offset, mirror_uv) })
const group = (name, uuid, origin, child, extra = {}) => ({ name, uuid: id(uuid), origin, rotation: [0, 0, 0], ...extra, children: [id(child)] })
const rotation = (time, x, y = 0, z = 0) => ({ channel: 'rotation', time, interpolation: 'catmullrom', data_points: [{ x, y, z }] })
const animator = (name, keyframes) => ({ type: 'bone', name, keyframes })
const degrees = radians => radians * 180 / Math.PI

function model() {
	const elements = [
		cube('head_cube', 1, [-4, 24, -4], [4, 32, 4], [0, 24, 0], [0, 0]),
		cube('body_cube', 2, [-4, 12, -2], [4, 24, 2], [0, 24, 0], [16, 16]),
		cube('right_arm_cube', 3, [-8, 12, -2], [-4, 24, 2], [-5, 22, 0], [40, 16]),
		cube('left_arm_cube', 4, [4, 12, -2], [8, 24, 2], [5, 22, 0], [40, 16], true),
		cube('right_leg_cube', 5, [-4, 0, -2], [0, 12, 2], [-1.9, 12, 0], [0, 16]),
		cube('left_leg_cube', 6, [0, 0, -2], [4, 12, 2], [1.9, 12, 0], [0, 16], true),
	]
	const children = [
		group('head', 11, [0, 24, 0], 1, { boneType: 'head', maxHeadRotX: 70, maxHeadRotY: 70 }),
		group('body', 12, [0, 24, 0], 2), group('right_arm', 13, [-5, 22, 0], 3),
		group('left_arm', 14, [5, 22, 0], 4), group('right_leg', 15, [-1.9, 12, 0], 5),
		group('left_leg', 16, [1.9, 12, 0], 6),
	]
	// Minecraft humanoid joints are Y-down; Blockbench is Y-up, so X/Z rotations change sign.
	const legAmplitude = degrees(1.4)
	const walk = {
		[id(15)]: animator('right_leg', [rotation(0, -legAmplitude), rotation(.5, 0), rotation(1, legAmplitude), rotation(1.5, 0), rotation(2, -legAmplitude)]),
		[id(16)]: animator('left_leg', [rotation(0, legAmplitude), rotation(.5, 0), rotation(1, -legAmplitude), rotation(1.5, 0), rotation(2, legAmplitude)]),
	}
	const ageCurveFrames = 200
	const ageCurveLength = ageCurveFrames / 20
	const ageZyRight = [], ageZyLeft = [], ageXRight = [], ageXLeft = []
	const attackYRight = [], attackYLeft = [], attackX = []
	for (let frame = 0; frame <= ageCurveFrames; frame++) {
		const phase = frame / ageCurveFrames * 2 * Math.PI
		ageZyRight.push(rotation(frame / 20, 0, degrees(-.1), -degrees(Math.cos(phase) * .05 + .05)))
		ageZyLeft.push(rotation(frame / 20, 0, degrees(.1), degrees(Math.cos(phase) * .05 + .05)))
		ageXRight.push(rotation(frame / 20, degrees(Math.PI / 2.25 + Math.sin(phase) * .05)))
		ageXLeft.push(rotation(frame / 20, degrees(Math.PI / 2.25 - Math.sin(phase) * .05)))
	}
	for (let tick = 0; tick <= 20; tick++) {
		const progress = tick / 20
		const first = Math.sin(progress * Math.PI)
		const second = Math.sin((1 - (1 - progress) ** 2) * Math.PI)
		const x = degrees(first * 1.2 - second * .4), y = degrees(first * .6)
		attackYRight.push(rotation(progress, 0, y))
		attackYLeft.push(rotation(progress, 0, -y))
		attackX.push(rotation(progress, -x))
	}
	const tint = ['head', 'body', 'right_arm', 'left_arm', 'right_leg', 'left_leg'].flatMap(target_bone => [
		{ channel: 'tint', time: 0, data_points: [{ target_bone, tint_mode: 'color', tint: '#ff5555' }] },
		{ channel: 'tint', time: .45, data_points: [{ target_bone, tint_mode: 'release', tint: '#ffffff' }] },
	])
	return {
		meta: { uuid: id(99), format_version: '1.0', model_format: 'ia/iaentitymodel', box_uv: false,
			settings: { iaentitymodel: { namespace: 'test', projectName: 'zombie_v2', entityFormat: 'v2' } } },
		resolution: { width: 64, height: 64 }, elements,
		outliner: [{ name: 'root', uuid: id(10), origin: [0, 0, 0], rotation: [0, 0, 0], children }],
		textures: [{ id: '0', uuid: id(30), name: 'zombie.png', source: `data:image/png;base64,${fs.readFileSync(textureSource).toString('base64')}`, folder: '', namespace: '', saved: true, uv_width: 64, uv_height: 64 }],
		animations: [
			{ name: 'idle', uuid: id(20), loop: 'hold', length: 1, animType: 'idle', animators: { [id(10)]: animator('root', [rotation(0, 0), rotation(1, 0)]) } },
			// Minecraft 1.21.1 BipedEntityModel advances limb radians by semantic phase * 0.6662.
			{ name: 'walk', uuid: id(21), loop: 'loop', length: 2, animType: 'walk', strideDistance: 2 * Math.PI / (0.6662 * 4), animators: walk },
			{ name: 'zombie_arm_age_zy', uuid: id(24), loop: 'loop', length: ageCurveLength, animType: 'other', layer: 'semantic_age_zy', priority: 10, semanticDriver: 'age', semanticPeriod: ageZPeriod, animators: {
				[id(13)]: animator('right_arm', ageZyRight), [id(14)]: animator('left_arm', ageZyLeft),
			} },
			{ name: 'zombie_arm_attack_y', uuid: id(25), loop: 'hold', length: 1, animType: 'other', layer: 'semantic_attack_y', priority: 20, semanticDriver: 'attack_progress', animators: {
				[id(13)]: animator('right_arm', attackYRight), [id(14)]: animator('left_arm', attackYLeft),
			} },
			{ name: 'zombie_arm_age_x', uuid: id(26), loop: 'loop', length: ageCurveLength, animType: 'other', layer: 'semantic_age_x', priority: 30, semanticDriver: 'age', semanticPeriod: ageXPeriod, animators: {
				[id(13)]: animator('right_arm', ageXRight), [id(14)]: animator('left_arm', ageXLeft),
			} },
			{ name: 'zombie_arm_aggressive', uuid: id(27), loop: 'hold', length: .05, animType: 'other', layer: 'semantic_aggressive', priority: 40, semanticDriver: 'aggressive', animators: {
				[id(13)]: animator('right_arm', [rotation(0, 0), rotation(.05, 40)]),
				[id(14)]: animator('left_arm', [rotation(0, 0), rotation(.05, 40)]),
			} },
			{ name: 'zombie_arm_attack_x', uuid: id(28), loop: 'hold', length: 1, animType: 'other', layer: 'semantic_attack_x', priority: 50, semanticDriver: 'attack_progress', animators: {
				[id(13)]: animator('right_arm', attackX), [id(14)]: animator('left_arm', attackX),
			} },
			{ name: 'hurt', uuid: id(22), loop: 'once', length: .5, animators: {
				[id(10)]: animator('root', [rotation(0, 0), rotation(.1, -8, 0, 4), rotation(.3, 3, 0, -2), rotation(.5, 0)]),
				effects: { type: 'effect', name: 'effects', keyframes: tint },
			} },
			{ name: 'death', uuid: id(23), loop: 'hold', length: 1, animators: {
				[id(10)]: animator('root', [rotation(0, 0), rotation(1, 0, 0, 90)]),
			} },
		],
	}
}

async function waitFor(files) {
	const deadline = Date.now() + 30_000
	while (!files.every(file => fs.existsSync(file) && fs.statSync(file).size)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${files.join(', ')}`)
		await new Promise(resolve => setTimeout(resolve, 25))
	}
}

async function run(page, { output }) {
	const fixture = model()
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
