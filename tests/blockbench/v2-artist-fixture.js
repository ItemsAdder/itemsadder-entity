'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const THREE = require('three')

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

function decodeDocument(bytes) {
	if (bytes.subarray(0, 4).toString() !== 'IAE2' || bytes.readUInt16LE(4) !== 2) throw new Error('Invalid artist V2 metadata')
	const size = bytes.readUInt32LE(8)
	const count = bytes.readUInt32LE(12)
	return {
		metadata: JSON.parse(bytes.subarray(16, 16 + size).toString('utf8')),
		matrices: Array.from({ length: count }, (_, index) => bytes.readFloatLE(16 + size + index * 4)),
	}
}

const decodeMetadata = bytes => decodeDocument(bytes).metadata

function flightRuntimeParity(document, evidence) {
	const unpack = index => {
		const value = document.matrices.slice(index * 12, index * 12 + 12)
		return new THREE.Matrix4().fromArray([value[0], value[1], value[2], 0, value[3], value[4], value[5], 0, value[6], value[7], value[8], 0, value[9] * 16, value[10] * 16, value[11] * 16, 1])
	}
	const parts = matrix => {
		const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3()
		matrix.decompose(position, rotation, scale)
		return { position, rotation: new THREE.Euler().setFromQuaternion(rotation, 'ZYX'), scale }
	}
	const wrap = value => Math.atan2(Math.sin(value), Math.cos(value))
	const animations = Object.fromEntries(document.metadata.animations.map(animation => [animation.name, animation]))
	let maxError = 0
	for (const sample of evidence.turns) for (const sourceName of Object.values(evidence.bones)) {
		const name = sourceName.toLowerCase().replace(/[^\w\d._]+/g, '_')
		const boneIndex = document.metadata.bones.findIndex(bone => bone.name === name)
		const rest = parts(unpack(document.metadata.bones[boneIndex].staticMatrix))
		const position = rest.position.clone(), scale = rest.scale.clone(), rotation = rest.rotation.clone()
		for (const [clip, weight] of [['fly', sample.weights[0]], ['fly_turn_left', sample.weights[1]], ['fly_turn_right', sample.weights[2]]]) {
			const animation = animations[clip]
			const mask = animation.channelMasks.find(([index]) => index === boneIndex)?.[1] || 0
			const target = parts(unpack(animation.tracks[name][Math.round((animation.sampleRate || 20) * 0.25)]))
			if (mask & 1) position.addScaledVector(target.position.clone().sub(rest.position), weight)
			if (mask & 2) {
				rotation.x += wrap(target.rotation.x - rest.rotation.x) * weight
				rotation.y += wrap(target.rotation.y - rest.rotation.y) * weight
				rotation.z += wrap(target.rotation.z - rest.rotation.z) * weight
			}
			if (mask & 4) scale.multiply(new THREE.Vector3(1 + (target.scale.x / rest.scale.x - 1) * weight, 1 + (target.scale.y / rest.scale.y - 1) * weight, 1 + (target.scale.z / rest.scale.z - 1) * weight))
		}
		const runtime = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale).elements
		const native = sample.bones[sourceName].localMatrix
		for (let index = 0; index < 16; index++) maxError = Math.max(maxError, Math.abs(runtime[index] - native[index]))
	}
	return maxError
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

async function runArtist(page, { sourcePath, outputRoot, id, namespace = 'test', entityType = 'ZOMBIE', flightBlend = false, proceduralMotion = false, preserveSavedConfig = false }) {
	const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
	const expectedEntityType = preserveSavedConfig ? source.meta?.settings?.iaentitymodel?.entityType : entityType
	const expectFlightBlend = preserveSavedConfig ? !!source.flight_blend : flightBlend
	const expectProceduralMotion = preserveSavedConfig ? !!source.procedural_motion : !!proceduralMotion
	const proceduralOptions = proceduralMotion === true ? { preset: 'vanilla_ender_dragon', autoMap: true,
		body: 'body', head: 'head',
		neck: ['neck0', 'neck1', 'neck2', 'neck3', 'neck4'], tail: Array.from({ length: 12 }, (_, index) => `tail${index}`),
		bodyFrame: { anchor: 'root', targets: ['body', 'left_wing', 'right_wing', 'left_front_leg', 'right_front_leg', 'left_hind_leg', 'right_hind_leg'], pivot: [0, -1, 0] } } : proceduralMotion
	const countGroups = nodes => (nodes || []).reduce((count, node) => count + (typeof node === 'object' ? 1 + countGroups(node.children) : 0), 0)
	const sourceGroupCount = source.groups?.length ?? countGroups(source.outliner)
	const projectPath = path.join(outputRoot, 'contents', namespace, `${id}.iaentitymodel`)
	const contentRoot = path.dirname(projectPath)
	const bundlePath = path.join(contentRoot, `${id}.iaentity`)
	fs.mkdirSync(contentRoot, { recursive: true })
	// The immutable original is opened with Blockbench's native project codec from this task-owned copy.
	fs.writeFileSync(projectPath, JSON.stringify(source, null, 2) + '\n')

	const result = await page.evaluate(async ({ model, projectPath, id, namespace, entityType, flightBlend, proceduralOptions, preserveSavedConfig, sourceGroupCount }) => {
		const codec = Codecs.iaentitymodel
		;(preserveSavedConfig ? codec : Codecs.project).load(model, { path: projectPath, no_file: true })
		if (Cube.all.length !== model.elements.filter(element => element.type === 'cube').length) throw new Error('Native Blockbench load changed artist cube count')
		if (Group.all.length !== sourceGroupCount) throw new Error(`Native Blockbench load changed artist bone count: ${Group.all.length}/${sourceGroupCount}`)
		if (Texture.all.length !== model.textures.length) throw new Error('Native Blockbench load changed artist texture count')
		if (Animation.all.length !== model.animations.length) throw new Error('Native Blockbench load changed artist animation count')
		const settings = { namespace, projectName: id, entityFormat: 'v2' }
		if (!preserveSavedConfig) settings.entityType = entityType
		Object.assign(IAENTITY.settings.iaentitymodel, settings)
		if (Format.id !== 'ia/iaentitymodel') Formats['ia/iaentitymodel'].convertTo()
		Object.assign(IAENTITY.settings.iaentitymodel, settings)
		IAENTITY.store.set('states', { default: {} })
		Project.name = id
		Project.geometry_name = id
		codec.afterSave(projectPath)
		if (Format.id !== 'ia/iaentitymodel') throw new Error('Artist project did not convert to ItemsAdder format')
		if (IAENTITY.settings.iaentitymodel.entityFormat !== 'v2') throw new Error('Artist project did not select V2')
		if (Cube.all.length !== model.elements.filter(element => element.type === 'cube').length) throw new Error('Artist cube count changed during conversion')
		if (Group.all.length !== sourceGroupCount) throw new Error('Artist bone count changed during conversion')
		if (Texture.all.length !== model.textures.length) throw new Error('Artist texture count changed during conversion')
		if (Animation.all.length !== model.animations.length) throw new Error('Artist animation count changed during conversion')
		let flightEvidence
		if (flightBlend) {
			const clips = Object.fromEntries(Animation.all.map(animation => [animation.name, animation]))
			for (const name of ['fly', 'fly_turn_left', 'fly_turn_right']) if (!clips[name]) throw new Error(`Missing ${name}`)
			const action = MenuBar.menus.iaentitymodel.structure.find(entry => entry?.id === 'iaentitymodel.flight_blend')
			if (!action) throw new Error('Flight Blend UI action is missing')
			action.click()
			if (Dialog.open?.id !== 'iaentitymodel_flight_blend') throw new Error('Flight Blend dialog did not open')
			Dialog.open.setFormValues({
				straight: clips.fly.uuid, left: clips.fly_turn_left.uuid, right: clips.fly_turn_right.uuid,
				previewTurn: 0, deadzone: 0.5, maxTurnRate: 8, smoothing: 0.35,
			})
			Dialog.open.confirm()
			const controller = AnimationController.all.find(entry => entry.name === 'controller.itemsadder.flight_blend')
			const state = controller?.states?.[0]
			if (!state || state.animations.length !== 3) throw new Error('Native flight controller was not configured')
			const sampleBones = { root: Group.all[0].name, wing: Group.all[1].name, tail: Group.all.at(-1).name }
			const started = state.start_timestamp
			const ownClock = Object.hasOwn(state, 'getStateTime')
			const getStateTime = state.getStateTime
			state.getStateTime = () => 0.25
			const turns = [-1, -0.5, 0, 0.5, 1]
			const samples = []
			action.click()
			for (const turn of turns) {
				Dialog.open.setFormValues({ previewTurn: turn })
				Dialog.open.onFormChange(Dialog.open.updateFormValues())
				Animator.preview(false)
				for (const group of Group.all) group.mesh.updateWorldMatrix(true, true)
				const current = AnimationController.all.find(entry => entry.name === controller.name)
				if (current !== controller || current.states[0] !== state || state.start_timestamp !== started) throw new Error('Preview turn restarted the native controller clock')
				samples.push({
					turn,
					weights: [1 - Math.abs(turn), Math.max(-turn, 0), Math.max(turn, 0)],
					nativeVariable: Animator.global_variable_lines['variable.itemsadder_flight_turn'],
					nativeWeights: state.animations.map(animation => Animator.MolangParser.parse(animation.blend_value)),
					bones: Object.fromEntries(Group.all.map(group => [group.name, {
						position: group.mesh.position.toArray(), rotation: group.mesh.rotation.toArray().slice(0, 3), scale: group.mesh.scale.toArray(),
						localMatrix: Array.from(group.mesh.matrix.elements),
					}])),
				})
			}
			Dialog.open.confirm()
			const zero = samples.find(sample => sample.turn === 0)
			clips.fly.select(); Timeline.time = 0.25; Animator.preview()
			const straight = Object.fromEntries(Group.all.map(group => [group.name, Array.from(group.mesh.matrix.elements)]))
			const maxError = Math.max(...Object.entries(straight).flatMap(([name, matrix]) => matrix.map((value, index) => Math.abs(value - zero.bones[name].localMatrix[index]))))
			if (maxError > 1e-7) throw new Error(`Flight Blend zero differs from straight: ${maxError}`)
			const root = samples.map(sample => sample.bones[sampleBones.root].rotation)
			if (!((root[0][1] - root[2][1]) * (root[4][1] - root[2][1]) < 0)) throw new Error(`Opposite preview signs do not produce opposite root turns: ${JSON.stringify({root, variables: samples.map(sample => [sample.nativeVariable, sample.nativeWeights]), selected: AnimationController.selected === controller})}`)
			if (ownClock) state.getStateTime = getStateTime
			else delete state.getStateTime
			flightEvidence = {
				bones: sampleBones,
				turns: samples.map(sample => ({ turn: sample.turn, weights: sample.weights, bones: sample.bones })),
				straightError: maxError,
				stateStartTimestamp: started,
				controllerAnimations: state.animations.map(animation => ({ animation: Animation.all.find(entry => entry.uuid === animation.animation)?.name, blendValue: animation.blend_value })),
			}
		}
		let proceduralEvidence
		if (proceduralOptions) {
			const action = MenuBar.menus.iaentitymodel.structure.find(entry => entry?.id === 'iaentitymodel.procedural_motion')
			if (!action) throw new Error('Procedural Flight Motion UI action is missing')
			action.click()
			if (Dialog.open?.id !== 'iaentitymodel_procedural_motion') throw new Error('Procedural Motion dialog did not open')
			const root = document.querySelector('.ia-procedural-motion')
			const click = label => {
				const target = [...root.querySelectorAll('button')].find(button => button.textContent === label)
				if (!target) throw new Error(`Missing Procedural Motion button: ${label}`)
				target.click()
			}
			const input = label => {
				const row = [...root.querySelectorAll('label')].find(row => row.querySelector('span')?.textContent === label)
				if (!row) throw new Error(`Missing Procedural Motion input: ${label}`)
				return row.querySelector('input,select')
			}
			if (proceduralOptions.autoMap) click('Auto-map obvious dragon names')
			else {
				for (const [label, name] of [['Body bone', proceduralOptions.body], ['Head bone (optional)', proceduralOptions.head]]) if (name) {
					const control = input(label), group = Group.all.find(group => group.name === name)
					if (!group) throw new Error(`Missing fixture bone ${name}`)
					control.value = group.uuid; control.dispatchEvent(new Event('change', { bubbles: true }))
				}
				for (const [names, label] of [[proceduralOptions.neck, 'Add selected bones as Neck Chain'], [proceduralOptions.tail, 'Add selected bones as Tail Chain']]) if (names?.length) {
					Outliner.selected.length = 0
					for (const name of names) { const group = Group.all.find(group => group.name === name); if (!group) throw new Error(`Missing fixture bone ${name}`); Outliner.selected.push(group) }
					click(label)
				}
			}
			const preset = input('Preset'); preset.value = proceduralOptions.preset; preset.dispatchEvent(new Event('change', { bubbles: true }))
			if (proceduralOptions.bodyFrame) {
				const anchor = input('Bank anchor'), anchorGroup = Group.all.find(group => group.name === proceduralOptions.bodyFrame.anchor)
				if (!anchorGroup) throw new Error('Missing explicit body-frame anchor')
				anchor.value = anchorGroup.uuid; anchor.dispatchEvent(new Event('change', { bubbles: true }))
				Outliner.selected.length = 0
				for (const name of proceduralOptions.bodyFrame.targets) {
					const group = Group.all.find(group => group.name === name)
					if (!group) throw new Error(`Missing explicit body-frame target ${name}`)
					Outliner.selected.push(group)
				}
				click('Add selected body-frame targets')
				for (const [axis, coordinate] of 'XYZ'.split('').entries()) {
					const pivot = input(`Bank pivot ${coordinate} (blocks)`)
					pivot.value = proceduralOptions.bodyFrame.pivot[axis]
					pivot.dispatchEvent(new Event('change', { bubbles: true }))
				}
			}
			const turn = input('Turn (Left / Right)'), vertical = input('Vertical (Down / Up)')
			const waitTicks = ticks => new Promise(resolve => setTimeout(resolve, ticks * 55))
			const capture = label => {
				const telemetry = JSON.parse(JSON.stringify(globalThis.IA_PROCEDURAL_PREVIEW || {}))
				const names = Group.all.filter(group => group.export !== false).map(group => group.name)
				telemetry.label = label
				telemetry.matrices = Object.fromEntries(names.map(name => {
					const group = Group.all.find(group => group.name === name)
					return [name, group ? { local: Array.from(group.mesh.matrix.elements), world: Array.from(group.mesh.matrixWorld.elements) } : null]
				}))
				return telemetry
			}
			click('Play Motion Preview'); await waitTicks(4)
			const straight = capture('straight')
			turn.value = '-1'; turn.dispatchEvent(new Event('input', { bubbles: true })); await waitTicks(16)
			const left = capture('sustained-left')
			turn.value = '1'; turn.dispatchEvent(new Event('input', { bubbles: true })); await waitTicks(8)
			const reversal = capture('left-to-right-transition')
			await waitTicks(18); const right = capture('sustained-right')
			vertical.value = '1'; vertical.dispatchEvent(new Event('input', { bubbles: true })); await waitTicks(8)
			const climb = capture('climb')
			click('Pause Motion Preview')
			const previewSamples = [straight, left, reversal, right, climb]
			const expectedSpatial = (proceduralOptions.neck?.length || 0) + (proceduralOptions.tail?.length || 0)
			for (const sample of previewSamples) {
				if (sample.spatial?.length !== expectedSpatial) throw new Error(`${id} preview omitted spatial-chain telemetry`)
				for (const entry of sample.spatial) if (!entry.pivot.every(Number.isFinite) || !Number.isFinite(entry.segmentLength))
					throw new Error(`${id} preview produced non-finite chain geometry`)
				if (proceduralOptions.head && proceduralOptions.neck?.length) {
					const attachment = sample.attachments?.[0]
					if (!attachment || attachment.afterMatrixError > 1e-8)
						throw new Error(`${id} preview detached the configured head: ${JSON.stringify(attachment)}`)
				}
			}
			const straightLengths = new Map(straight.spatial.map(entry => [entry.bone, entry.segmentLength]))
			for (const sample of previewSamples) for (const entry of sample.spatial)
				if (Math.abs(entry.segmentLength - straightLengths.get(entry.bone)) > 1e-5)
					throw new Error(`${id} preview stretched chain segment ${entry.bone}`)
			const terminal = proceduralOptions.tail?.at(-1) || proceduralOptions.neck?.at(-1)
			if (terminal) {
				const pivot = sample => sample.spatial.find(entry => entry.bone === terminal).pivot
				if (Math.hypot(...pivot(left).map((value, axis) => value - pivot(straight)[axis])) < .01)
					throw new Error(`${id} flat-chain endpoint did not move spatially`)
			}
			Dialog.open.confirm()
			const config = Project.proceduralMotion
			if (config?.preset !== proceduralOptions.preset || config.neck.length !== (proceduralOptions.neck?.length || 0) || config.tail.length !== (proceduralOptions.tail?.length || 0)) throw new Error(`Procedural mapping failed: ${JSON.stringify(config)}`)
			if (proceduralOptions.bodyFrame && (config.bodyFrame?.targets.length !== proceduralOptions.bodyFrame.targets.length
				|| config.bodyFrame?.pivot.some((value, axis) => value !== proceduralOptions.bodyFrame.pivot[axis])))
				throw new Error(`Explicit body-frame mapping failed: ${JSON.stringify(config.bodyFrame)}`)
			proceduralEvidence = { config, samples: previewSamples }
		}
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
			flightEvidence,
			proceduralEvidence,
			oracle: {
				schema: 'blockbench-artist-oracle-v1', namespace, project: id,
				source: { cubes: Cube.all.length, bones: Group.all.length, textures: Texture.all.length, animations: Animation.all.map(animation => animation.name) },
				samples,
			},
		}
	}, { model: source, projectPath, id, namespace, entityType, flightBlend, proceduralOptions, preserveSavedConfig, sourceGroupCount })
	fs.writeFileSync(projectPath, result.project.endsWith('\n') ? result.project : `${result.project}\n`)
	const compiled = JSON.parse(result.project)
	assert.deepEqual(animationInventory(compiled), animationInventory(source), `${id} animation channels/interpolation changed during conversion`)
	assert.deepEqual(embeddedTextureHashes(compiled), embeddedTextureHashes(source), `${id} embedded project textures changed`)
	const reopened = await page.evaluate(async ({ project, projectPath, expectFlightBlend, expectProceduralMotion }) => {
		if (!expectFlightBlend && !expectProceduralMotion) return null
		Codecs.iaentitymodel.load(JSON.parse(project), { path: projectPath, no_file: true })
		Codecs.iaentitymodel.afterSave(projectPath)
		await new Promise(resolve => setTimeout(resolve, 0))
		const controller = AnimationController.all.find(entry => entry.name === 'controller.itemsadder.flight_blend')
		return { config: Project.flightBlend, procedural: Project.proceduralMotion, controller: controller?.states?.[0]?.animations?.length || 0 }
	}, { project: result.project, projectPath, expectFlightBlend, expectProceduralMotion })
	if (flightBlend) {
		assert.equal(hasFlightControllerAnimations(result.flightEvidence), true)
	}
	if (expectFlightBlend) assert.equal(reopened.controller, 3, `${id} native controller did not survive reopen`)
	if (proceduralOptions) {
		assert.equal(reopened.procedural?.preset, proceduralOptions.preset, `${id} Procedural Motion preset did not survive reopen`)
		assert.equal(reopened.procedural?.neck?.length, proceduralOptions.neck?.length || 0, `${id} neck chain did not survive reopen`)
		assert.equal(reopened.procedural?.tail?.length, proceduralOptions.tail?.length || 0, `${id} tail chain did not survive reopen`)
	}

	async function exportOnce() {
		fs.rmSync(bundlePath, { force: true })
		await page.evaluate(async () => {
			IAENTITY.store.getStore('exporters').get('vanillaAnimationExporter')()
			await new Promise(resolve => setTimeout(resolve, 0))
			const deadline = Date.now() + 45_000
			while (IAENTITY.exportInProgress && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
			if (IAENTITY.exportInProgress) throw new Error('Timed out waiting for artist V2 export')
		})
		await waitForFile(bundlePath)
		return filesBelow(contentRoot)
	}
	const first = await exportOnce()
	const second = await exportOnce()
	assert.deepEqual([...second.keys()], [...first.keys()], `${id} export file list is nondeterministic`)
	for (const [name, bytes] of first) assert(second.get(name).equals(bytes), `${id} export is nondeterministic: ${name}`)

	assert.ok(first.has(`${id}.iaentity`), `${id} V2 bundle is missing`)
	assert.ok(![...first.keys()].some(name => name.startsWith('resourcepack/') || name.endsWith('.yml')), `${id} exported legacy pack files`)
	const metadataBytes = first.get(path.relative(contentRoot, bundlePath).replace(/\\/g, '/'))
	const document = decodeDocument(metadataBytes)
	const metadata = document.metadata
	const savedProject = JSON.parse(result.project)
	assert.equal(metadata.transformSpace, 'local')
	assert.deepEqual(metadata.entity, { namespace, id, type: expectedEntityType, canSunBurn: false })
	assert.deepEqual(metadata.animations.map(animation => animation.name), source.animations.map(animation => animation.name))
	if (expectFlightBlend) {
		assert.deepEqual(metadata.extensions?.['itemsadder:flight_blend'], {
			straight: 'fly', left: 'fly_turn_left', right: 'fly_turn_right', deadzone: 0.5, maxTurnRate: 8, smoothing: 0.35,
		})
		assert.ok(reopened.config?.straight && reopened.config?.left && reopened.config?.right, `${id} Flight Blend config did not survive reopen`)
		if (flightBlend) {
			result.flightEvidence.runtimeParityMaxError = flightRuntimeParity(document, result.flightEvidence)
			assert.ok(result.flightEvidence.runtimeParityMaxError < 2e-5, `${id} native preview/runtime parity error ${result.flightEvidence.runtimeParityMaxError}`)
		}
	} else assert.equal(metadata.extensions?.['itemsadder:flight_blend'], undefined, `${id} retained stale Flight Blend metadata`)
	if (expectProceduralMotion) {
		const motion = metadata.extensions?.['itemsadder:procedural_motion']
		assert.equal(motion?.preset, preserveSavedConfig ? source.procedural_motion.preset : proceduralOptions.preset)
		if (preserveSavedConfig) {
			assert.deepEqual(motion?.neck?.bones || [], ['neck0', 'neck1', 'neck2', 'neck3', 'neck4'])
			assert.deepEqual(motion?.tail?.bones || [], Array.from({ length: 12 }, (_, index) => `tail${index}`))
			assert.ok(motion?.body?.bone); assert.equal(motion?.head?.bone, 'head')
		} else {
			assert.deepEqual(motion?.neck?.bones || [], proceduralOptions.neck || [])
			assert.deepEqual(motion?.tail?.bones || [], proceduralOptions.tail || [])
			assert.equal(motion?.body?.bone, proceduralOptions.body); assert.equal(motion?.head?.bone, proceduralOptions.head)
			const reversal = result.proceduralEvidence.samples.find(sample => sample.label === 'left-to-right-transition')
			const byBone = Object.fromEntries(reversal.telemetry.map(entry => [entry.bone, entry]))
			if (proceduralOptions.head && proceduralOptions.tail?.length && !(byBone[proceduralOptions.head].rotation[1] > 0 && Math.abs(byBone[proceduralOptions.tail[0]].rotation[1]) < Math.abs(byBone[proceduralOptions.tail.at(-1)].rotation[1]))) throw new Error(`Procedural reversal did not propagate: ${JSON.stringify(byBone)}`)
			if (!result.proceduralEvidence.samples.every(sample => Object.values(sample.matrices).filter(Boolean).every(value => [...value.local, ...value.world].every(Number.isFinite)))) throw new Error('Procedural preview produced a non-finite matrix')
		}
	} else assert.equal(metadata.extensions?.['itemsadder:procedural_motion'], undefined, `${id} retained stale Procedural Motion metadata`)
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
		const expectedFrames = Math.ceil(animation.length * (animation.sampleRate || 20)) + 1
		for (const track of Object.values(animation.tracks)) assert.equal(track.length, expectedFrames, `${id}/${animation.name} frame count`)
	}
	assert.deepEqual(Object.keys(metadata.geometryProfiles), ['compatible', 'single_axis_45', 'unrestricted'])
	for (const profile of Object.keys(metadata.geometryProfiles)) {
		assert.deepEqual(Object.keys(metadata.geometryModels[profile]), Object.keys(metadata.geometryProfiles[profile]))
		for (const bone of Object.keys(metadata.geometryProfiles[profile]))
			assert.equal(metadata.geometryModels[profile][bone].length, metadata.geometryProfiles[profile][bone].length)
	}
	const sourceTextureHashes = embeddedTextureHashes(source)
	if (id === 'armored_grub') {
		const sourceFace = source.elements[0].faces.north
		const texture = source.textures[sourceFace.texture]
		assert.notEqual(source.resolution.width, texture.uv_width, 'Armored grub fixture must exercise per-texture UV resolution')
		const expected = sourceFace.uv.map((value, axis) => value * 16 / (axis % 2 ? texture.uv_height : texture.uv_width))
		const exportedUvs = Object.values(metadata.geometryModels.compatible)
			.flatMap(fragments => fragments.flatMap(fragment => fragment.model.elements || []))
			.flatMap(element => Object.values(element.faces || {}).map(face => face.uv))
		assert.ok(exportedUvs.some(uv => uv?.length === expected.length && uv.every((value, index) => Math.abs(value - expected[index]) < 1e-9)),
			'Armored grub export did not normalize face UVs with its 128x128 texture canvas')
	}
	const exportedTextureHashes = Object.entries(metadata.textures || {}).map(([digest, encoded]) => {
		const bytes = Buffer.from(encoded, 'base64')
		assert.equal(digest, hash(bytes), `${id} embedded texture digest mismatch`)
		return digest
	}).sort()
	assert.ok(exportedTextureHashes.length && exportedTextureHashes.every(value => sourceTextureHashes.includes(value)), `${id} embedded texture table differs from source`)
	for (const profile of Object.values(metadata.geometryModels)) for (const fragments of Object.values(profile)) for (const fragment of fragments) {
		const model = fragment.model
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
		preserved: { cubes: source.elements.length, bones: sourceGroupCount, textures: source.textures.length, animations: animationInventory(source) },
		flightBlend: result.flightEvidence,
		proceduralMotion: result.proceduralEvidence,
		unsupportedSourceEditorMetadata: Object.keys(source).filter(key => ['multi_file_ruleset', 'timeline_setups', 'unhandled_root_fields', 'variable_placeholder_buttons'].includes(key)),
		exportFiles: first.size, metadata: path.relative(outputRoot, bundlePath).replace(/\\/g, '/'), oracle: 'oracle.json',
	}, null, 2) + '\n')
	return { id, outputRoot, projectPath, oraclePath, reportPath, files: first.size, bones: metadata.bones.length, animations: metadata.animations.map(animation => animation.name) }
}

function hasFlightControllerAnimations(evidence) {
	return evidence?.controllerAnimations?.map(entry => entry.animation).join(',') === 'fly,fly_turn_left,fly_turn_right'
}

module.exports = { runArtist }
