import { encodeEntityV2 } from '../format/entityV2'
import { safeFunctionName } from '../util/replace'
import { store } from '../util/store'
import { isLoopMarker } from '../constants/loopMarkers'
import { GEOMETRY_PROFILE_NAMES } from './v2GeometryProfiles'
import { exportedParentChain } from './v2LocalTransforms'
import { authoredChannelMasks } from './v2LocalTransforms'
import { sampleBoneEffectTracks } from '../boneEffects'
import { locomotionStrideSettings, nonDefaultAnimationLayerSettings, semanticDriverSettings } from '../animationSettings'
import { v2EmbeddedTextureMeta, v2EmbeddedTextures } from '../format/v2EmbeddedTextures'
import { compileProceduralMotion } from '../proceduralMotion'

declare const Group: any
declare const Animation: any
declare const Project: any

/** Convert evaluated editor matrices into a deterministic indexed pose table. */
export function createV2AnimationFile(data: any): { animationFile: Buffer } {
	const staticId = store.get('staticAnimationUuid')
	const unsupportedPivot = Group.all.find((group: any) => ['hatPivot', 'leftHandPivot', 'rightHandPivot'].includes(group.boneType))
	if (unsupportedPivot) throw new Error(`Native V2 equipment pivot '${unsupportedPivot.boneType}' is not supported on bone '${unsupportedPivot.name}'`)
	if (Group.all.some((group: any) => group.boneType === 'hitbox' || group.name === 'hitbox'))
		throw new Error('Native V2 custom hitboxes are not supported; use the base entity hitbox')
	const variants = Object.keys(data.variantModels || {}).filter(name => name !== 'default' && Object.keys(data.variantModels[name]).length > 0).sort()
	const rest = data.animations[staticId].frames[0].bones
	const matrices: number[] = []
	const indices = new Map<string, number>()
	function matrixIndex(frame: any, scale = 1): number {
		if (!frame?.matrix || frame.matrix.length !== 12) throw new Error('Missing V2 bone matrix')
		const values = frame.matrix.map((value: number, i: number) => Math.fround(value * (i < 9 ? scale : 1)))
		if (!values.every(Number.isFinite)) throw new Error('Non-finite V2 bone matrix')
		const key = values.join(',')
		const existing = indices.get(key)
		if (existing !== undefined) return existing
		const index = matrices.length / 12
		matrices.push(...values)
		indices.set(key, index)
		return index
	}
	const groups = Group.all.filter((group: any) => rest[safeFunctionName(group.name)] && group.boneType !== 'hitbox' && group.name !== 'hitbox')
	const groupSet = new Set(groups)
	const bones = groups.map((group: any) => {
		const name = safeFunctionName(group.name)
		const model = data.models[name]
		const hasModel = model?.elements?.some((element: any) => element.from && element.to)
		const geometryScale = model?.v2GeometryScale || 1
		const parents = exportedParentChain(group, groupSet).map(parent => safeFunctionName(parent.name))
		return {
			name, boneType: hasModel ? (group.boneType || 'normal') : (group.boneType && group.boneType !== 'normal' ? group.boneType : 'locator'),
			parents, geometryScale, staticMatrix: matrixIndex(rest[name]),
			maxHeadRotX: group.maxHeadRotX ?? 70, maxHeadRotY: group.maxHeadRotY ?? 45,
		}
	})
	const animations = Object.entries(data.animations).filter(([id]) => id !== staticId).map(([id, entry]: [string, any]) => {
		const tracks: Record<string, number[]> = Object.create(null)
		for (const bone of bones) tracks[bone.name] = entry.frames.map((frame: any) => matrixIndex(frame.bones[bone.name]))
		const original = Animation.all.find((animation: any) => animation.uuid === id)
		const markers = (original?.markers || []).filter(isLoopMarker).map((marker: any) => marker.time).sort((a: number, b: number) => a - b)
		const propertyTracks = sampleBoneEffectTracks(original?.animators?.effects?.keyframes || [], entry.length, bones.map((bone: any) => bone.name))
		return {
			name: entry.name, length: entry.length, loopMode: entry.loopMode, animType: entry.animType || 'other',
			...(original?.ia_v2_sample_rate !== undefined && original.ia_v2_sample_rate !== 20
				? { sampleRate: original.ia_v2_sample_rate } : {}),
			canPlayerMove: entry.canPlayerMove === true || entry.canPlayerMove === 'true', tracks,
			channelMasks: authoredChannelMasks(original, groups),
			...nonDefaultAnimationLayerSettings(original),
			...semanticDriverSettings(original),
			...locomotionStrideSettings({ ...entry, strideDistance: original?.strideDistance,
				locomotionMode: original?.locomotionMode, restOnStop: original?.restOnStop }),
			effects: {
				sounds: { keyframes: entry.frames.map((frame: any) => frame.effects.sounds) },
				particles: { keyframes: entry.frames.map((frame: any) => frame.effects.particles) },
				...(variants.length ? { texture_variant: { keyframes: entry.frames.map((frame: any) => frame.effects.texture_variant || 'default') } } : {}),
				...(Object.keys(propertyTracks.visibility).length ? { visibility: { tracks: propertyTracks.visibility } } : {}),
				...(Object.keys(propertyTracks.tint).length ? { tint: { tracks: propertyTracks.tint } } : {}),
			},
			...(markers.length >= 2 ? { loopStartTime: markers[0], loopEndTime: markers[1] } : {}),
		}
	})
	if (animations.length === 0) {
		const tracks: Record<string, number[]> = Object.create(null)
		for (const bone of bones) tracks[bone.name] = [bone.staticMatrix, bone.staticMatrix]
		animations.push({ name: 'idle', length: 0.05, loopMode: 'hold', animType: 'idle', canPlayerMove: false,
			channelMasks: [], tracks, effects: { sounds: { keyframes: [[], []] }, particles: { keyframes: [[], []] } } })
	}
	const geometryProfiles = data.geometryProfiles ? Object.fromEntries(GEOMETRY_PROFILE_NAMES.map(profileName => {
		const profile: Record<string, number[]> = Object.create(null)
		for (const bone of bones.filter((entry: any) => entry.boneType === 'normal' || entry.boneType === 'head')) {
			const fragments = data.geometryProfiles[profileName]?.[bone.name]
			if (!fragments?.length) throw new Error(`Missing ${profileName} geometry for ${bone.name}`)
			profile[bone.name] = fragments.map((fragment: any) => matrixIndex({ matrix: fragment.staticLocalMatrix }, 1))
		}
		return [profileName, profile]
	})) : undefined
	const textures = v2EmbeddedTextures()
	const textureMeta = v2EmbeddedTextureMeta()
	const flight = Project.flightBlend
	const animationName = (uuid: string, label: string) => {
		if (!uuid) return undefined
		const animation = Animation.all.find((entry: any) => entry.uuid === uuid)
		if (!animation) throw new Error(`Flight Blend ${label} animation no longer exists`)
		return animation.name
	}
	const flightBlend = flight?.straight ? {
		straight: animationName(flight.straight, 'straight'),
		...(flight.left ? { left: animationName(flight.left, 'left') } : {}),
		...(flight.right ? { right: animationName(flight.right, 'right') } : {}),
		deadzone: Number(flight.deadzone ?? 0.5), maxTurnRate: Number(flight.maxTurnRate ?? 8),
		smoothing: Number(flight.smoothing ?? 0.35),
	} : undefined
	if (flightBlend?.left && flightBlend.right) {
		for (const animation of animations) {
			if (animation.name === flightBlend.straight) animation.animType = 'fly'
			else if (animation.name === flightBlend.left || animation.name === flightBlend.right) animation.animType = 'other'
		}
	}
	const proceduralMotion = compileProceduralMotion(Project.proceduralMotion, Group.all)
	const entitySettings: any = data.settings.iaentitymodel
	const extensions = {
		...(flightBlend ? { 'itemsadder:flight_blend': flightBlend } : {}),
		...(proceduralMotion ? { 'itemsadder:procedural_motion': proceduralMotion } : {}),
	}
	const metadata = {
		schema: 'iae2', transformSpace: 'local', matrixCount: matrices.length / 12, bones, animations,
		entity: {
			namespace: entitySettings.namespace,
			id: entitySettings.projectName,
			type: entitySettings.entityType || 'ZOMBIE',
			canSunBurn: false,
		},
		...(Object.keys(textures).length ? { textures } : {}),
		...(Object.keys(textureMeta).length ? { textureMeta } : {}),
		...(variants.length ? { variants } : {}),
		...(geometryProfiles ? { geometryProfiles } : {}),
		...(data.geometryProfiles ? { geometryModels: Object.fromEntries(GEOMETRY_PROFILE_NAMES.map(profileName => [profileName,
			Object.fromEntries(Object.entries(data.geometryProfiles[profileName] as Record<string, any[]>).map(([bone, fragments]) => [bone,
				fragments.map((fragment: any) => ({ model: fragment.model, variants: fragment.variants }))
			]))
		])) } : {}),
		...(Object.keys(extensions).length ? { extensions } : {}),
	}
	return { animationFile: Buffer.from(encodeEntityV2({ metadata, matrices })) }
}
