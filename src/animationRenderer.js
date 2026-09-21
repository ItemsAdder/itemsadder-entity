import * as path from 'path'
import { settings } from './settings'
import { affectedBones, localJointMatrix } from './exporters/v2LocalTransforms'
import { sampleTextureVariant, textureVariants } from './textureVariant'
import { Async } from './util/async'
import { roundToN } from './util/misc'
import * as hash from './util/hash'
import { store } from './util/store'
import * as os from 'os'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { StructTypes, StructPacker } from 'struct-packer'
import { gunzipSync, gzipSync } from 'zlib'
import { tl } from './util/intl'
import { format, safeFunctionName } from './util/replace'
import { isSceneBased } from './util/hasSceneAsParent'
import {Euler} from "three";
import {isInternalModel, needsToExportJsonsModels} from "./util/utilz";
import {
	ANIMATION_POSITION_ROUNDING,
	EXTERNAL_HAND_PIVOT_OFFSET,
	EXTERNAL_HAT_PIVOT_OFFSET,
	INTERNAL_PLAYER_PIVOT_OFFSET,
	MINECRAFT_MODEL_UNIT,
} from './constants/compat'
store.set('staticAnimationUuid', '138747e7-2de0-4130-b900-9275ca0e6333')

function setAnimatorTime(time) {
	Timeline.setTime(time, false)
}

// function getTimelineSavePoint() {
// 	return {
// 		time: Timeline.time,
// 		cubes: [...Cube.selected],
// 		animation: Animator.selected,
// 		keyframes: [...Timeline.selected],
// 	}
// }

// function applyTimelineSavePoint(point) {
// 	point.animation?.select()
// 	selected = point.cubes
// 	Timeline.selected = point.keyframes
// 	setAnimatorTime(point.time)
// }
function getRotations(animation) {
	const bones = {}
	Group.all.forEach((group) => {
		bones[group.name] = animation
			.getBoneAnimator(group)
			.interpolate('rotation') || [0, 0, 0]
	})
	const results = {}
	function getRotation(obj3d) {
		// TODO: Is that needed at all?
		const prevQuat = obj3d.quaternion.clone()
		const worldQuat = obj3d.getWorldQuaternion(new THREE.Quaternion())
		const e = new THREE.Euler(1, 1, 1, 'ZYX').setFromQuaternion(worldQuat)
		obj3d.quaternion = prevQuat
		return [
			(e.x * 180) / Math.PI,
			(e.y * 180) / Math.PI,
			(e.z * 180) / Math.PI,
		]
	}
	Group.all.forEach((group) => {
		results[group.name] = getRotation(group.mesh)
	})
	return results
}

function getPositions() {
	const result = {}
	Group.all.forEach((group) => {
		
		// Fix the hands offset calculation because items are shown on top of armorstand head not directly on the neck. 
		let prevPos = group.mesh.position.clone();
		if(group.boneType === "leftHandPivot" || group.boneType === "rightHandPivot" || group.boneType === "hatPivot") {
			if (isInternalModel(settings)) {
				group.mesh.position.x += INTERNAL_PLAYER_PIVOT_OFFSET.x
				group.mesh.position.y += INTERNAL_PLAYER_PIVOT_OFFSET.y
				group.mesh.position.z += INTERNAL_PLAYER_PIVOT_OFFSET.z
			} else {
				if (group.boneType === "rightHandPivot") {
					group.mesh.position.x += EXTERNAL_HAND_PIVOT_OFFSET.x
					group.mesh.position.y += EXTERNAL_HAND_PIVOT_OFFSET.y
					group.mesh.position.z += EXTERNAL_HAND_PIVOT_OFFSET.z
				} else if (group.boneType === "leftHandPivot") {
					group.mesh.position.x += EXTERNAL_HAND_PIVOT_OFFSET.x
					group.mesh.position.y += EXTERNAL_HAND_PIVOT_OFFSET.y
					group.mesh.position.z += EXTERNAL_HAND_PIVOT_OFFSET.z
				}

				if (group.boneType === "hatPivot") {
					group.mesh.position.y += EXTERNAL_HAT_PIVOT_OFFSET.y
					group.mesh.position.z += EXTERNAL_HAT_PIVOT_OFFSET.z
				}
			}
		}
		
		let pos = group.mesh.getWorldPosition(new THREE.Vector3())
		pos.x = roundToN(pos.x / MINECRAFT_MODEL_UNIT, ANIMATION_POSITION_ROUNDING)
		pos.y = roundToN(pos.y / MINECRAFT_MODEL_UNIT, ANIMATION_POSITION_ROUNDING)
		pos.z = roundToN(pos.z / MINECRAFT_MODEL_UNIT, ANIMATION_POSITION_ROUNDING)
		result[group.name] = pos

		group.mesh.position = prevPos
	})
	return result
}

function getScales() {
	const result = {}
	Group.all.forEach((group) => {
		result[group.name] = group.mesh.getWorldScale(new THREE.Vector3())
	})
	return result
}

function getData(animation, renderedGroups) {
	Animator.preview(false)
	const nativeDisplay = settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings)
	const renderedSet = nativeDisplay ? new Set(renderedGroups) : null
	const pos = getPositions()
	const rot = getRotations(animation)
	const scl = getScales()
	const res = {}
	renderedGroups.forEach((group) => {
		const thisPos = pos[group.name]
		const thisRot = rot[group.name]
		const groupName = safeFunctionName(group.name)
		res[groupName] = {
			...(nativeDisplay ? { matrix: localJointMatrix(group, renderedSet) } : {}),
			pos: {
				x: -thisPos.x,
				y: thisPos.y,
				z: -thisPos.z,
			},
			rot: {
				x: -thisRot[0],
				y: -thisRot[1],
				z: thisRot[2],
			},
			scale: scl[group.name],
		}
	})
	return res
}

const vec3 = StructTypes.Object({
	x: StructTypes.Float,
	y: StructTypes.Float,
	z: StructTypes.Float,
})
const struct = StructTypes.Object({
	frames: StructTypes.ArrayOf(
		StructTypes.Object({
			bones: StructTypes.ObjectOf(
				StructTypes.String,
				StructTypes.Object({
					pos: vec3,
					rot: vec3,
					scale: vec3,
				})
			),
			scripts: StructTypes.Object({}),
		})
	),
	maxDistance: StructTypes.Double,
	name: StructTypes.String,
	loopMode: StructTypes.String,
})

StructPacker.defaultPreReadHandlers = [(buf) => gunzipSync(buf)]
StructPacker.defaultPostWriteHandlers = [(buf) => gzipSync(buf)]
const packer = StructPacker.create(struct)
function animToWriteable(animData) {
	return packer.write(animData)
}
function writtenAnimToReadable(data) {
	return packer.read(data)
}
const Cache = new (class {
	constructor() {
		this.cache = new Map()
		this.tmp = path.join(
			os.tmpdir(),
			`iaentitymodel-${Math.random().toString(16).substr(2)}`
		)
		this.data = new Map()
		settings.watch('iaentitymodel.cacheMode', () => {
			this.initDiskCache()
		})
		settings.watch('iaentitymodel.useCache', () => {
			this.clear()
		})
		this.initDiskCache()
	}
	initDiskCache() {
		if (settings.iaentitymodel.cacheMode === 'file') {
			console.log(`Anim Cache: using cache at ${this.tmp}`)
			mkdirSync(this.tmp, { recursive: true })
			for (const [key, value] of this.data) {
				writeFileSync(path.join(this.tmp, key + '.anim_data'), animToWriteable(value))
			}
		} else if (existsSync(this.tmp)) {
			console.log(`Anim Cache: removing cache at ${this.tmp}`)
			rmSync(this.tmp, {
				recursive: true,
			})
		}
	}
	hit(anim) {
		if (!settings.iaentitymodel.useCache) return null
		if (this.cache.has(anim.uuid)) {
			const old_hash = this.cache.get(anim.uuid)
			const new_hash = hash.animation(anim)
			const hit = old_hash !== new_hash
			if (!hit) {
				if (settings.iaentitymodel.cacheMode === 'memory') {
					return this.data.get(anim.uuid)
				} else {
					const data = readFileSync(
						path.join(this.tmp, anim.uuid + '.anim_data')
					)

					data._isBuffer = true
					return writtenAnimToReadable(data)
				}
			}
			return null
		} else {
			this.cache.set(anim.uuid, hash.animation(anim))
			return null
		}
	}
	update(anim, value) {
		if (!settings.iaentitymodel.useCache) return
		if (settings.iaentitymodel.cacheMode === 'memory') {
			this.data.set(anim.uuid, value)
		} else {
			writeFileSync(
				path.join(this.tmp, anim.uuid + '.anim_data'),
				animToWriteable(value)
			)
		}
		this.cache.set(anim.uuid, hash.animation(anim))
	}
	clear() {
		this.data = new Map()
		this.cache = new Map()
	}
})()

// clear the animation cache if the origin or rotation of a group changes
// const $original_func = NodePreviewController.prototype.updateTransform
// NodePreviewController.prototype.updateTransform = function (el) {
// 	if (Group.selected) Cache.clear()
// 	return $original_func.bind(this)(el)
// }
// bus.on(events.LIFECYCLE.CLEANUP, () => {
// 	NodePreviewController.prototype.updateTransform = $original_func
// })

let boneStructureHash

async function renderAnimation(options) {
	console.groupCollapsed('Render Animations')
	// const timeline_save = get_timeline_save_point();
	unselectAll()
	Timeline.unselect()
	let static_animation
	let avalue

	if (options.generate_static_animation) {
		static_animation = new Animation({
			name: 'iaentitymodel.staticAnimation',
			snapping: 20,
			length: 0,
		}).add(false)
		static_animation.uuid = store.get('staticAnimationUuid')
	}

	const totalAnimationLength = Animator.animations.reduce(
		(a, v) => a + v.length,
		0
	)
	// Accumulated animation length
	let accAnimationLength = 0
	const tldMessage = tl('iaentitymodel.progress.animationRendering')
	const progressUpdaterID = setInterval(() => {
		console.log(accAnimationLength, totalAnimationLength)
		Blockbench.setStatusBarText(
			format(tldMessage, {
				current: accAnimationLength.toFixed(2),
				total: totalAnimationLength.toFixed(2),
			})
		)
		Blockbench.setProgress(accAnimationLength / totalAnimationLength, 50)
	}, 50)

	try {
		// fix_scene_rotation();
		const animations = {}
		const renderedGroups = Group.all.filter(
			(group) =>
				!isSceneBased(group) &&
				group.visibility &&
				(
					(settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings) && group.export) ||
					group.boneType === "head" || group.boneType === "leftHandPivot" || group.boneType === "rightHandPivot" || group.boneType === "hatPivot" || group.boneType === "mount" || group.boneType === "locator" || group.boneType === "hitbox" ||
					group.children.find((child) => child instanceof Cube)
				)
		)
		console.log('All Groups:', Group.all)
		console.log('Rendered Groups:', renderedGroups)

		const newBoneStructureHash = hash.boneStructure()
		if (boneStructureHash !== newBoneStructureHash) {
			boneStructureHash = newBoneStructureHash
			Cache.clear()
		}

		for (const animation of Animator.animations.sort()) {
			
			// Fix animation snapping
			// Sampling uses explicit times; never change the user's editor snapping.

			const nativeDisplay = settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings)
			const textureVariantNames = nativeDisplay ? textureVariants(store.get('states')) : []
			const value = nativeDisplay ? null : Cache.hit(animation)
			if (!value) {
				let maxDistance = -Infinity
				const frames = []
				animation.select()
				const animLength =
					animation.loop === 'loop'
						? animation.length
						: animation.length + 0.05

				if (!Number.isFinite(animation.length) || animation.length < 0 || animation.length > 3600)
					throw new Error('Animation length must be finite and at most one hour')
				const sampleCount = nativeDisplay ? Math.ceil(animation.length * 20) : Math.round(animLength * 20)
				for (let sample = 0; sample <= sampleCount; sample++) {
					const i = Math.min(sample / 20, animation.length)
					accAnimationLength += 0.05
					await Async.wait_if_overflow()
					setAnimatorTime(i)
					const effects = {
						sounds: [],
						particles: [],
						texture_variant: nativeDisplay ? sampleTextureVariant(animation.animators.effects?.keyframes || [], i, textureVariantNames) : 'default'
					}
					if (animation.animators.effects) {
						const time = Math.round(i * 20) / 20
						animation.animators.effects.keyframes
							.filter((keyframe) => keyframe.time === time)
							.forEach((keyframe) => {
								if (keyframe.channel === 'sound') {

									keyframe.data_points.forEach(x => {
										effects.sounds.push({
											name: x.name,
											volume: x.volume,
											pitch: x.pitch
										})
									})
								}
								if (keyframe.channel === 'particle') {

									keyframe.data_points.forEach(x => {
										effects.particles.push({
											name: x.name,
											locator: x.locator_name,
											speed: x.speed,
											count: x.count,
											x_delta: x.x_delta,
											y_delta: x.y_delta,
											z_delta: x.z_delta
										})
									})
								}
							})
					}

					const frame = {
						bones: getData(animation, renderedGroups),
						effects: effects
					}
					let fdist = -Infinity
					for (const bone of Object.values(frame.bones)) {
						fdist = Math.max(
							fdist,
							Math.sqrt(
								bone.pos.x * bone.pos.x +
									bone.pos.y * bone.pos.y +
									bone.pos.z * bone.pos.z
							)
						)
					}
					maxDistance = Math.max(maxDistance, fdist)
					frames.push(frame)
				}
				avalue = {
					frames,
					maxDistance,
					...(nativeDisplay ? { affectedBones: affectedBones(animation, renderedGroups) } : {}),
					animType: animation.animType,
					canPlayerMove: animation.canPlayerMove,
					name: animation.name,
					loopMode: animation.loop,
					length: animation.length
				}
				animations[animation.uuid] = avalue
				if (!nativeDisplay) Cache.update(animation, avalue)
			} else {
				animations[animation.uuid] = value
			}
		}

		// apply_timeline_save_point(timeline_save);
		// unfix_scene_rotation();

		static_animation?.remove()
		Canvas.updateAllBones()
		clearInterval(progressUpdaterID)
		Blockbench.setStatusBarText()
		Blockbench.setProgress(0, 0)
		console.groupEnd()
		return animations
	} catch (error) {
		// unfix_scene_rotation();
		static_animation?.remove()
		Canvas.updateAllBones()
		clearInterval(progressUpdaterID)
		Blockbench.setStatusBarText()
		Blockbench.setProgress(0, 0)
		console.groupEnd()
		throw error
	}
}
export { renderAnimation }
