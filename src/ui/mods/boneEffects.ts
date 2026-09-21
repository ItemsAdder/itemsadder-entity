import { format as modelFormat } from '../../modelFormat'
import { settings } from '../../settings'
import { sampleBoneEffects } from '../../boneEffects'
import { safeFunctionName } from '../../util/replace'
import { bus } from '../../util/bus'
import events from '../../constants/events'

declare const EffectAnimator: any
declare const KeyframeDataPoint: any
declare const Property: any
declare const Format: any
declare const Animation: any
declare const Timeline: any
declare const Group: any
declare const Cube: any

let properties: any[] = []
let previousChannels: Record<string, any> = {}
let boneNames: string[] = []
let previewRestore: (() => void) | undefined

function externalV2() {
	return Format.id === modelFormat.id && settings.iaentitymodel.entityFormat === 'v2'
}

function refreshBones(datalist: HTMLDataListElement) {
	boneNames = Group.all.filter((group: any) => group.export).map((group: any) => safeFunctionName(group.name)).sort()
	datalist.replaceChildren(...boneNames.map(value => Object.assign(document.createElement('option'), { value })))
}

function restorePreview() {
	previewRestore?.()
	previewRestore = undefined
}

function applyPreview() {
	if (!externalV2()) return
	const keyframes = Animation.selected?.animators?.effects?.keyframes || []
	const effects = sampleBoneEffects(keyframes, Timeline.time, boneNames)
	const restore: (() => void)[] = []
	for (const channel of ['visibility', 'tint'] as const) for (const [boneName, value] of Object.entries(effects[channel])) {
		if (value === null || value === -1) continue
		const group = Group.all.find((candidate: any) => safeFunctionName(candidate.name) === boneName)
		if (!group) continue
		for (const cube of group.children.filter((child: any) => child instanceof Cube)) {
			const mesh = cube.mesh
			if (!mesh) continue
			if (channel === 'visibility') {
				const visible = mesh.visible
				restore.push(() => { mesh.visible = visible })
				mesh.visible = value
			} else {
				const material = mesh.material
				restore.push(() => { mesh.material = material })
				const tint = (entry: any) => {
					const copy = entry?.clone?.() || entry
					;(copy?.color || copy?.uniforms?.LIGHTCOLOR?.value)?.setHex(value)
					return copy
				}
				mesh.material = Array.isArray(material) ? material.map(tint) : tint(material)
			}
		}
	}
	previewRestore = () => restore.forEach(action => action())
}

export function registerBoneEffectsMod() {
	if (properties.length) return
	const bones = document.createElement('datalist')
	bones.id = 'ia_bone_effect_targets'
	document.body.append(bones)
	const bindInputs = () => {
		const target = document.querySelector('#keyframe_bar_target_bone input')
		if (target) target.setAttribute('list', bones.id)
		const tint = document.querySelector('#keyframe_bar_tint input') as HTMLInputElement | null
		if (tint) tint.type = 'color'
	}
	const observer = new MutationObserver(bindInputs)
	observer.observe(document.body, { childList: true, subtree: true })
	refreshBones(bones)
	for (const channel of ['visibility', 'tint']) {
		previousChannels[channel] = EffectAnimator.prototype.channels[channel]
		EffectAnimator.prototype.channels[channel] = {
			name: channel === 'visibility' ? 'Bone visibility' : 'Bone tint', mutable: true, max_data_points: 1,
			condition: externalV2,
		}
	}
	properties = [
		new Property(KeyframeDataPoint, 'enum', 'target_bone', {
			default: '',
			condition: (point: any) => externalV2() && ['visibility', 'tint'].includes(point.keyframe.channel),
		}),
		new Property(KeyframeDataPoint, 'enum', 'visibility', {
			default: 'visible', values: ['release', 'visible', 'hidden'],
			condition: (point: any) => externalV2() && point.keyframe.channel === 'visibility',
		}),
		new Property(KeyframeDataPoint, 'enum', 'tint_mode', {
			default: 'color', values: ['release', 'color'],
			condition: (point: any) => externalV2() && point.keyframe.channel === 'tint',
		}),
		new Property(KeyframeDataPoint, 'string', 'tint', {
			default: '#ffffff',
			condition: (point: any) => externalV2() && point.keyframe.channel === 'tint' && point.tint_mode !== 'release',
		}),
	]
	const unregisterBefore = bus.on('v2_animation_preview_before', restorePreview)
	const unregisterAfter = bus.on('v2_animation_preview', applyPreview)
	const unregisterLoad = bus.on(events.LIFECYCLE.LOAD_MODEL, () => { restorePreview(); refreshBones(bones) })
	bus.on(events.LIFECYCLE.CLEANUP, () => {
		unregisterBefore(); unregisterAfter(); unregisterLoad(); restorePreview()
		observer.disconnect(); bones.remove()
		properties.forEach(property => property.delete()); properties = []
		for (const channel of ['visibility', 'tint']) {
			if (previousChannels[channel] === undefined) delete EffectAnimator.prototype.channels[channel]
			else EffectAnimator.prototype.channels[channel] = previousChannels[channel]
		}
		previousChannels = {}
	})
}
