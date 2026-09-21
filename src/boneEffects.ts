export const BONE_EFFECT_CHANNELS = ['visibility', 'tint'] as const

type Visibility = boolean | null
type Tint = number
type BoneEffects = { visibility: Record<string, Visibility>; tint: Record<string, Tint> }
export type BoneEffectTracks = {
	visibility: Record<string, Visibility[]>
	tint: Record<string, Tint[]>
}

const RELEASE_TINT = -1

function value(channel: typeof BONE_EFFECT_CHANNELS[number], point: any): Visibility | Tint {
	if (channel === 'visibility') {
		if (point.visibility === 'release') return null
		if (point.visibility === 'visible') return true
		if (point.visibility === 'hidden') return false
		throw new Error(`Invalid visibility value: ${point.visibility}`)
	}
	if (point.tint_mode === 'release' || point.tint === 'release') return RELEASE_TINT
	if (typeof point.tint !== 'string' || !/^#[0-9a-f]{6}$/i.test(point.tint)) throw new Error(`Invalid tint value: ${point.tint}`)
	return Number.parseInt(point.tint.slice(1), 16)
}

export function sampleBoneEffects(keyframes: any[], time: number, bones: readonly string[]): BoneEffects {
	if (!Number.isFinite(time) || time < 0) throw new Error('Bone effect sample time must be finite and non-negative')
	const known = new Set(bones)
	const result: BoneEffects = { visibility: {}, tint: {} }
	const selectedTime: Record<string, Record<string, number>> = { visibility: {}, tint: {} }
	for (const keyframe of keyframes) {
		if (!BONE_EFFECT_CHANNELS.includes(keyframe?.channel)) continue
		if (!Number.isFinite(keyframe.time) || keyframe.time < 0) throw new Error('Bone effect keyframe time must be finite and non-negative')
		const channel = keyframe.channel as typeof BONE_EFFECT_CHANNELS[number]
		for (const point of keyframe.data_points || []) {
			const bone = point?.target_bone
			if (typeof bone !== 'string' || !known.has(bone)) throw new Error(`Unknown bone effect target: ${bone}`)
			const parsed = value(channel, point)
			if (keyframe.time <= time && keyframe.time >= (selectedTime[channel][bone] ?? -Infinity)) {
				result[channel][bone] = parsed as never
				selectedTime[channel][bone] = keyframe.time
			}
		}
	}
	return result
}

export function sampleBoneEffectTracks(keyframes: any[], length: number, bones: readonly string[]): BoneEffectTracks {
	if (!Number.isFinite(length) || length < 0 || length > 3600) throw new Error('Bone effect animation length must be finite and at most one hour')
	const result: BoneEffectTracks = { visibility: {}, tint: {} }
	for (let frame = 0; frame <= Math.ceil(length * 20); frame++) {
		const sampled = sampleBoneEffects(keyframes, Math.min(frame / 20, length), bones)
		for (const channel of BONE_EFFECT_CHANNELS) for (const [bone, current] of Object.entries(sampled[channel])) {
			const release = channel === 'visibility' ? null : RELEASE_TINT
			const track = result[channel][bone] || (result[channel][bone] = Array(frame).fill(release) as never)
			track.push(current as never)
		}
		for (const channel of BONE_EFFECT_CHANNELS) for (const track of Object.values(result[channel])) {
			if (track.length === frame) track.push((channel === 'visibility' ? null : RELEASE_TINT) as never)
		}
	}
	return result
}
