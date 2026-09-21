'use strict'

// Node-side Playwright scenario. Its page.evaluate body is the editor oracle: it reads live
// Blockbench mesh matrices/vertices, never exporter matrices. The caller writes the returned
// JSON to the task-owned output path, avoiding a UI file dialog.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const root = path.resolve(__dirname, '..', '..')
const fixturePath = path.join(root, 'test-fixtures/v2/blockbench/v2_fixture.iaentitymodel')
const textureSource = path.join(root, 'src/assets/mc-build.png')
const blinkTextureSource = path.join(root, 'src/assets/transparent.png')

function waitForFiles(files) {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + 10_000
		const poll = () => {
			if (files.every(file => fs.existsSync(file) && fs.statSync(file).size > 0)) return resolve()
			if (Date.now() >= deadline) return reject(new Error(`Exporter did not write ${files.join(', ')}`))
			setTimeout(poll, 25)
		}
		poll()
	})
}

function decodeEntityV2(bytes) {
	if (bytes.subarray(0, 4).toString('utf8') !== 'IAE2' || bytes.readUInt16LE(4) !== 2) throw new Error('Invalid V2 fixture export header')
	const jsonBytes = bytes.readUInt32LE(8)
	const metadata = JSON.parse(bytes.subarray(16, 16 + jsonBytes).toString('utf8'))
	const matrices = []
	for (let offset = 16 + jsonBytes; offset < bytes.length; offset += 4) matrices.push(bytes.readFloatLE(offset))
	return { metadata, matrices }
}

function metadataMatrix(document, index) {
	return document.matrices.slice(index * 12, index * 12 + 12)
}

function nativeLocalMatrix(local) {
	const result = []
	for (let column = 0; column < 4; column++) for (let row = 0; row < 3; row++) {
		result.push(Math.fround(local[column * 4 + row] * (column === 3 ? 1 / 16 : 1)))
	}
	return result
}

function equalMatrix(actual, expected, label) {
	if (actual.length !== expected.length || actual.some((value, index) => Math.abs(value - expected[index]) > 1e-6)) {
		throw new Error(`V2 matrix differs from Blockbench editor oracle: ${label}`)
	}
}

// projectPath must be a task-local file below `contents/test/`; Blockbench records it as
// Project.save_path so the real exporter passes its namespace safety check. The launcher
// must grant that parent directory to Flatpak.
async function run(page, { oraclePath, projectPath }) {
	if (!path.isAbsolute(projectPath)) throw new Error('projectPath must be absolute')
	if (!projectPath.replace(/\\/g, '/').includes('/contents/test/')) {
		throw new Error('projectPath must be inside task-local contents/test/')
	}
	const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
	const projectRoot = path.dirname(projectPath)
	const resourceRoot = path.join(projectRoot, 'resourcepack', 'assets', 'test')
	const textureDigest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
	const baseDigest = textureDigest(textureSource)
	const blinkDigest = textureDigest(blinkTextureSource)
	const metadataPath = path.join(resourceRoot, 'models', 'entity', 'v2_fixture', '.metadata')
	const modelsRoot = path.dirname(metadataPath)
	const texturePath = path.join(resourceRoot, 'textures', 'ia_v2', `${baseDigest}.png`)
	const rootModelPath = path.join(modelsRoot, 'profiles', 'compatible', 'root', '0.json')
	const tipModelPath = path.join(modelsRoot, 'profiles', 'compatible', 'tip', '0.json')
	const blinkModelPath = path.join(modelsRoot, 'profiles', 'compatible', 'blink', 'root', '0.json')
	const blinkTexturePath = path.join(resourceRoot, 'textures', 'ia_v2', `${blinkDigest}.png`)
	if (!fs.existsSync(textureSource) || !fs.existsSync(blinkTextureSource)) throw new Error('Missing checked-in V2 fixture textures')
	fixture.textures[0].path = textureSource
	fixture.textures[0].saved = true
	fixture.textures[1].path = blinkTextureSource
	fixture.textures[1].saved = true
	// A real saved project and resource-pack root make this an exporter test, not merely a codec test.
	fs.mkdirSync(resourceRoot, { recursive: true })
	fs.writeFileSync(projectPath, JSON.stringify(fixture, null, 2) + '\n')
	const oracle = await page.evaluate(async ({ model, projectPath }) => {
		const step = label => console.info(`IAE_V2_STEP ${label}`)
		const codec = Codecs.iaentitymodel
		if (!codec) throw new Error('ItemsAdder codec is not registered')
		codec.load(model, { path: projectPath })
		const projectSettings = IAENTITY.settings.iaentitymodel
		if (projectSettings.namespace !== 'test' || projectSettings.projectName !== 'v2_fixture' || projectSettings.entityFormat !== 'v2') {
			throw new Error(`Fixture settings did not load as native V2: ${JSON.stringify(projectSettings)}`)
		}
		const waitFor = async (check, label) => {
			const deadline = Date.now() + 5_000
			while (!check()) {
				if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`)
				await new Promise(resolve => setTimeout(resolve, 25))
			}
		}
		const panel = Interface.Panels.aj_states
		await waitFor(() => panel?.node.querySelector('#java-animator-states .add_animation'), 'V2 variants panel')
		panel.node.querySelector('#java-animator-states .add_animation').click()
		await waitFor(() => IAENTITY.store.get('states')?.state_1, 'created texture variant')
		const createdInput = Array.from(panel.node.querySelectorAll('input')).find(input => input.value === 'state_1')
		if (!createdInput) throw new Error('Created texture variant is not editable in the panel')
		createdInput.value = 'ui_variant'
		createdInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
		await waitFor(() => IAENTITY.store.get('states')?.ui_variant, 'renamed texture variant')
		const createdRow = Array.from(panel.node.querySelectorAll('li.animation_file')).find(row => row.querySelector('input')?.value === 'ui_variant')
		createdRow.querySelector('.material-icons')?.closest('.in_list_button')?.click()
		await waitFor(() => panel.node.querySelector('.Dropdown-root'), 'texture variant editor')
		panel.node.querySelector('.Dropdown-control').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
		await waitFor(() => document.querySelectorAll('.Dropdown-option').length, 'texture replacement choices')
		const replacement = Texture.all.find(texture => texture.uuid === '10000000-0000-4000-8000-000000000031')
		const base = Texture.all.find(texture => texture.uuid === '10000000-0000-4000-8000-000000000030')
		const replacementOption = Array.from(document.querySelectorAll('.Dropdown-option')).find(option => option.textContent.includes(replacement.name))
		if (!replacementOption) throw new Error('Replacement texture is not selectable in the variant editor')
		replacementOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
		await waitFor(() => IAENTITY.store.get('states')?.ui_variant?.[base.uuid] === replacement.uuid, 'edited texture replacement')
		if (base.getMaterial()?.map?.image?.src !== replacement.source) throw new Error('Variant editor did not preview the replacement texture')
		const roundTrip = JSON.parse(codec.compile())
		if (roundTrip.meta.variants.ui_variant[base.uuid] !== replacement.uuid) throw new Error('UI-created texture variant did not round-trip through the project codec')
		panel.node.querySelector('.dialog_close_button')?.click()
		createdRow.querySelectorAll('.material-icons').forEach(icon => { if (icon.textContent.trim() === 'delete') icon.closest('.in_list_button').click() })
		await waitFor(() => !IAENTITY.store.get('states')?.ui_variant, 'texture variant deletion')
		step('variant-ui')

		function findAnimation(name) {
			const result = Animation.all.find((entry) => entry.name === name)
			if (!result || result.length !== 1 || result.loop !== 'hold') throw new Error(`Missing one-second hold animation ${name}`)
			return result
		}

		function sample(animation, time) {
			Modes.options.animate.select()
			Canvas.updateAll()
			animation.select()
			Timeline.time = time
			Animator.preview()
			for (const group of Group.all) group.mesh.updateWorldMatrix(true, true)
			return Group.all.filter((group) => ['root', 'middle', 'tip'].includes(group.name)).map((group) => {
				return {
					bone: group.name,
					groupMatrixLocal: Array.from(group.mesh.matrix.elements),
					groupMatrixWorld: Array.from(group.mesh.matrixWorld.elements),
					cubes: group.children.filter((entry) => entry.type === 'cube').map((cube) => {
						if (!cube.mesh?.geometry?.attributes?.position) throw new Error(`Missing cube geometry under ${group.name}`)
						return {
							cube: cube.name,
							matrixWorld: Array.from(cube.mesh.matrixWorld.elements),
							vertices: Array.from(cube.mesh.geometry.attributes.position.array),
						}
					}),
				}
			})
		}

		const neutral = findAnimation('neutral')
		const held = findAnimation('held')
		const override = findAnimation('override')
		const variantKeyframe = held.animators.effects?.keyframes.find(keyframe => keyframe.channel === 'texture_variant')
		if (!variantKeyframe || variantKeyframe.data_points[0].variant !== 'blink') throw new Error('Texture variant keyframe did not load')
		if (!EffectAnimator.prototype.channels.texture_variant?.condition(held.animators.effects)) throw new Error('Texture variant channel is unavailable in a native V2 animation')
		Modes.options.animate.select()
		held.select()
		variantKeyframe.select()
		await waitFor(() => document.querySelector('#keyframe_bar_variant input[list="ia_texture_variants"]'), 'texture variant keyframe dropdown')
		const variantSelect = document.querySelector('#keyframe_bar_variant input[list="ia_texture_variants"]')
		const dropdownValues = Array.from(document.querySelectorAll('#ia_texture_variants option')).map(option => option.value)
		if (!dropdownValues.includes('default') || !dropdownValues.includes('blink')) throw new Error('Texture variant keyframe dropdown is missing declared choices')
		variantSelect.value = 'default'; variantSelect.dispatchEvent(new Event('input', { bubbles: true }))
		await waitFor(() => variantKeyframe.data_points[0].variant === 'default', 'texture variant keyframe edit')
		variantSelect.value = 'blink'; variantSelect.dispatchEvent(new Event('input', { bubbles: true }))
		await waitFor(() => variantKeyframe.data_points[0].variant === 'blink', 'texture variant keyframe restore')
		const visibilityKeyframe = held.animators.effects.keyframes.find(keyframe => keyframe.channel === 'visibility' && keyframe.time === 0.2)
		const tintKeyframe = held.animators.effects.keyframes.find(keyframe => keyframe.channel === 'tint' && keyframe.time === 0.1)
		const soundKeyframe = held.animators.effects.keyframes.find(keyframe => keyframe.channel === 'sound' && keyframe.time === 0.4)
		const particleKeyframe = held.animators.effects.keyframes.find(keyframe => keyframe.channel === 'particle' && keyframe.time === 0.5)
		if (!visibilityKeyframe || !tintKeyframe || soundKeyframe?.data_points[0].name !== 'minecraft:block.note_block.pling'
			|| particleKeyframe?.data_points[0].name !== 'minecraft:happy_villager') throw new Error('Animation effect keyframes did not load')
		if (!EffectAnimator.prototype.channels.visibility?.condition(held.animators.effects) || !EffectAnimator.prototype.channels.tint?.condition(held.animators.effects)) {
			throw new Error('Bone effect channels are unavailable in a native V2 animation')
		}
		visibilityKeyframe.select()
		await waitFor(() => document.querySelector('#keyframe_bar_target_bone input[list="ia_bone_effect_targets"]'), 'bone effect target dropdown')
		await waitFor(() => document.querySelector('#keyframe_bar_visibility select, #keyframe_bar_visibility input'), 'bone visibility editor')
		const visibilitySelect = document.querySelector('#keyframe_bar_visibility select, #keyframe_bar_visibility input')
		visibilitySelect.value = 'visible'
		visibilitySelect.dispatchEvent(new Event('input', { bubbles: true }))
		visibilitySelect.dispatchEvent(new Event('change', { bubbles: true }))
		await waitFor(() => visibilityKeyframe.data_points[0].visibility === 'visible', 'bone visibility keyframe edit')
		visibilitySelect.value = 'hidden'
		visibilitySelect.dispatchEvent(new Event('input', { bubbles: true }))
		visibilitySelect.dispatchEvent(new Event('change', { bubbles: true }))
		await waitFor(() => visibilityKeyframe.data_points[0].visibility === 'hidden', 'bone visibility keyframe restore')
		tintKeyframe.select()
		await waitFor(() => document.querySelector('#keyframe_bar_tint input[type="color"]'), 'bone tint color editor')
		step('effect-ui')

		const layerMenu = Animation.prototype.menu.structure.find(entry => entry?.name === 'V2 Layer Settings…')
		if (!layerMenu || !layerMenu.condition()) throw new Error('V2 layer settings action is unavailable')
		layerMenu.click(held)
		await waitFor(() => document.querySelector('#iaentitymodel_v2_layer_settings .confirm_btn'), 'V2 layer settings dialog')
		Dialog.open.setFormValues({ layer: 'combat', priority: 7, blendIn: 0.25, blendOut: 0.4 })
		document.querySelector('#iaentitymodel_v2_layer_settings .confirm_btn').click()
		await waitFor(() => held.layer === 'combat' && held.priority === 7 && held.blendIn === 0.25 && held.blendOut === 0.4, 'V2 layer settings edit')
		const animationRoundTrip = JSON.parse(codec.compile()).animations.find(animation => animation.name === 'held')
		if (animationRoundTrip?.layer !== 'combat' || animationRoundTrip.priority !== 7 || animationRoundTrip.blendIn !== 0.25 || animationRoundTrip.blendOut !== 0.4) {
			throw new Error('V2 layer settings did not round-trip through the project codec')
		}
		step('layer-ui')

		const directCube = bone => Group.all.find(group => group.name === bone)?.children.find(child => child.type === 'cube')
		Timeline.time = 0.25; Animator.preview()
		if (base.getMaterial()?.map?.image?.src !== replacement.source) throw new Error('Texture variant timeline preview did not apply blink')
		if (directCube('root')?.mesh?.visible !== false) throw new Error('Bone visibility timeline preview did not hide root')
		const tintedMaterial = directCube('tip')?.mesh?.material
		const materialColor = material => (material?.color || material?.uniforms?.LIGHTCOLOR?.value)?.getHex?.()
		if (!(Array.isArray(tintedMaterial) ? tintedMaterial : [tintedMaterial]).some(material => materialColor(material) === 0xff0000)) {
			throw new Error('Bone tint timeline preview did not tint tip red')
		}
		Timeline.time = 0.75; Animator.preview()
		if (base.getMaterial()?.map?.image?.src !== base.source) throw new Error('Texture variant timeline preview did not restore default')
		if (directCube('root')?.mesh?.visible !== true) throw new Error('Bone visibility timeline preview did not release root')
		const restoredMaterial = directCube('tip')?.mesh?.material
		if ((Array.isArray(restoredMaterial) ? restoredMaterial : [restoredMaterial]).some(material => materialColor(material) === 0xff0000)) {
			throw new Error('Bone tint timeline preview did not release tip')
		}
		step('preview')
		const samples = {
			neutral: { t0: sample(neutral, 0), t1: sample(neutral, 1) },
			held: { t0: sample(held, 0), t1: sample(held, 1) },
			override: { t0: sample(override, 0), t1: sample(override, 1) },
		}
		for (const poses of Object.values(samples)) for (const pose of Object.values(poses)) {
			for (const bone of pose) {
				const values = [
					...bone.groupMatrixLocal,
					...bone.groupMatrixWorld,
					...bone.cubes.flatMap((cube) => [...cube.matrixWorld, ...cube.vertices]),
				]
				if (!values.every(Number.isFinite)) throw new Error(`Non-finite editor oracle for ${bone.bone}`)
			}
		}

		return { schema: 'blockbench-editor-oracle-v1', namespace: 'test', project: 'v2_fixture', samples }
	}, { model: fixture, projectPath })
	async function exportOnce() {
		// Require fresh output: a swallowed exporter error must not pass on an earlier run's files.
		for (const file of [metadataPath, rootModelPath, tipModelPath, blinkModelPath, texturePath, blinkTexturePath]) {
			fs.rmSync(file, { force: true })
		}
		await page.evaluate(async () => {
			const exporter = IAENTITY.store.getStore('exporters').get('vanillaAnimationExporter')
			exporter()
			await new Promise(resolve => setTimeout(resolve, 0))
			const deadline = Date.now() + 30_000
			while (IAENTITY.exportInProgress && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
			if (IAENTITY.exportInProgress) throw new Error('Timed out waiting for ItemsAdder V2 export')
		})
		await waitForFiles([metadataPath, rootModelPath, tipModelPath, blinkModelPath, texturePath, blinkTexturePath])
		return {
			metadata: fs.readFileSync(metadataPath),
			root: fs.readFileSync(rootModelPath),
			tip: fs.readFileSync(tipModelPath),
			blink: fs.readFileSync(blinkModelPath),
			texture: fs.readFileSync(texturePath),
			blinkTexture: fs.readFileSync(blinkTexturePath),
		}
	}
	const first = await exportOnce()
	const document = decodeEntityV2(first.metadata)
	const metadata = document.metadata
	if (metadata.transformSpace !== 'local') throw new Error('V2 export did not use local transform space')
	if (JSON.stringify(Object.keys(metadata.textures || {})) !== JSON.stringify([baseDigest, blinkDigest].sort())) throw new Error('V2 embedded texture digests were not exported deterministically')
	for (const [digest, source] of [[baseDigest, textureSource], [blinkDigest, blinkTextureSource]]) {
		if (!Buffer.from(metadata.textures[digest], 'base64').equals(fs.readFileSync(source))) throw new Error(`V2 embedded texture payload differs: ${digest}`)
	}
	if (JSON.stringify(metadata.variants) !== JSON.stringify(['blink'])) throw new Error('V2 texture variants were not deterministically exported')
	if (JSON.stringify(Object.keys(metadata.geometryProfiles || {})) !== JSON.stringify(['compatible', 'single_axis_45', 'unrestricted'])) throw new Error('V2 geometry profiles were not exported')
	const blinkFrames = metadata.animations.find(animation => animation.name === 'held')?.effects?.texture_variant?.keyframes
	if (!blinkFrames || blinkFrames[0] !== 'default' || !blinkFrames.includes('blink') || blinkFrames[blinkFrames.length - 1] !== 'default') throw new Error('V2 blink/default timeline state was not exported')
	const bones = new Map(metadata.bones.map(bone => [bone.name, bone]))
	const visualBones = metadata.bones.filter(bone => bone.boneType === 'normal')
	if (bones.size !== 3 || visualBones.length !== 2 || ['root', 'tip'].some(name => bones.get(name)?.boneType !== 'normal')) throw new Error('V2 cube bones were exported as locators')
	for (const [name, parents] of [['root', []], ['middle', ['root']], ['tip', ['middle', 'root']]]) {
		if (JSON.stringify(bones.get(name)?.parents) !== JSON.stringify(parents)) throw new Error(`Wrong local parent for ${name}`)
	}
	for (const [name, bytes] of [['root', first.root], ['tip', first.tip]]) {
		const model = JSON.parse(bytes.toString('utf8'))
		if (!Array.isArray(model.elements) || model.elements.length === 0) throw new Error(`V2 ${name} model has no cube elements`)
	}
	const blinkModel = JSON.parse(first.blink.toString('utf8'))
	if (blinkModel.textures?.['0'] !== `test:ia_v2/${blinkDigest}`) throw new Error('V2 blink model does not reference the replacement texture digest')
	if (blinkModel.parent !== 'test:entity/v2_fixture/profiles/compatible/root/0') throw new Error('V2 blink profile model has the wrong parent')
	if (!first.texture.equals(fs.readFileSync(textureSource)) || !first.blinkTexture.equals(fs.readFileSync(blinkTextureSource))) throw new Error('V2 exported texture bytes differ from their editor sources')
	const neutral = new Map(oracle.samples.neutral.t0.map(sample => [sample.bone, sample.groupMatrixLocal]))
	const held = new Map(oracle.samples.held.t1.map(sample => [sample.bone, sample.groupMatrixLocal]))
	if (['root', 'middle', 'tip'].every(name => neutral.get(name).every((value, index) => Math.abs(value - held.get(name)[index]) < 1e-6))) {
		throw new Error('Held editor oracle did not differ from the neutral pose')
	}
	for (const bone of metadata.bones) equalMatrix(metadataMatrix(document, bone.staticMatrix), nativeLocalMatrix(neutral.get(bone.name)), `static ${bone.name}`)
	const heldAnimation = metadata.animations.find(animation => animation.name === 'held')
	if (JSON.stringify(heldAnimation?.channelMasks) !== JSON.stringify([[0, 2], [1, 5], [2, 2]])) throw new Error('Held authored channel masks were not exported deterministically')
	if (heldAnimation.layer !== 'combat' || heldAnimation.priority !== 7 || heldAnimation.blendIn !== 0.25 || heldAnimation.blendOut !== 0.4) throw new Error('Held layer settings were not exported')
	const overrideAnimation = metadata.animations.find(animation => animation.name === 'override')
	if (JSON.stringify(overrideAnimation?.channelMasks) !== JSON.stringify([[0, 2]])
		|| overrideAnimation.layer !== 'cinematic' || overrideAnimation.priority !== 12
		|| overrideAnimation.blendIn !== 0.15 || overrideAnimation.blendOut !== 0.2) throw new Error('Override layer settings were not exported')
	if (!heldAnimation.effects.sounds.keyframes.some(frame => frame.some(effect => effect.name === 'minecraft:block.note_block.pling'))
		|| !heldAnimation.effects.particles.keyframes.some(frame => frame.some(effect => effect.name === 'minecraft:happy_villager'))) {
		throw new Error('Sound/particle keyframes were not exported')
	}
	const visibility = heldAnimation.effects?.visibility?.tracks?.root
	if (visibility?.length !== 21 || visibility[3] !== null || visibility[4] !== false || visibility[11] !== false || visibility[12] !== null) throw new Error('Held visibility track was not sampled correctly')
	const tint = heldAnimation.effects?.tint?.tracks?.tip
	if (tint?.length !== 21 || tint[1] !== -1 || tint[2] !== 0xff0000 || tint[13] !== 0xff0000 || tint[14] !== -1) throw new Error('Held tint track was not sampled correctly')
	for (const bone of metadata.bones) {
		const frames = heldAnimation?.tracks?.[bone.name]
		if (!frames?.length) throw new Error(`Missing held V2 track for ${bone.name}`)
		equalMatrix(metadataMatrix(document, frames[frames.length - 1]), nativeLocalMatrix(held.get(bone.name)), `held ${bone.name}`)
	}
	const second = await exportOnce()
	for (const name of ['metadata', 'root', 'tip', 'blink', 'texture', 'blinkTexture']) if (!first[name].equals(second[name])) throw new Error(`Nondeterministic V2 re-export: ${name}`)
	fs.mkdirSync(path.dirname(oraclePath), { recursive: true })
	fs.writeFileSync(oraclePath, JSON.stringify(oracle, null, 2) + '\n')
	return oracle
}

module.exports = { fixturePath, run }
