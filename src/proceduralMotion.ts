import { safeFunctionName } from './util/replace'

export type ProjectProceduralMotion = {
	enabled: boolean
	preset: 'dragon' | 'vanilla_ender_dragon' | 'custom'
	root?: string
	body?: string
	head?: string
	neck: string[]
	tail: string[]
	neckFollow: number
	neckFlexibility: number
	tailFollow: number
	tailFlexibility: number
	historyTicks: number
	bodyBank: number
	headFollow: number
	vertical: number
	wave: number
	bodyFrame?: { anchor: string, targets: string[], pivot: [number, number, number] }
}

export type MotionBone = {
	bone: string
	sampleDelay: number
	referenceDelay: number
	verticalSampleDelay?: number
	verticalReferenceDelay?: number
	rollReferenceStartDelay?: number
	rollReferenceEndDelay?: number
	rollReferenceBlend?: number
	yawInfluence: number
	verticalInfluence: number
	rollInfluence: number
	follow: number
	response: number
}

export type MotionChain = Omit<MotionBone, 'bone' | 'sampleDelay'> & {
	bones: string[]
	startDelay: number
	endDelay: number
	waveAmplitude: number
	waveFrequency: number
}

export type RuntimeProceduralMotion = {
	preset: ProjectProceduralMotion['preset']
	historyTicks: number
	phaseSource?: 'elapsed' | 'native'
	root?: MotionBone
	body?: MotionBone
	head?: MotionBone
	neck?: MotionChain
	tail?: MotionChain
	bodyFrame?: { anchor: string, targets: string[], pivot: [number, number, number] }
}

export const defaultProceduralMotion = (): ProjectProceduralMotion => ({
	enabled: true, preset: 'dragon', neck: [], tail: [], neckFollow: 0.9, neckFlexibility: 0.65,
	tailFollow: 0.95, tailFlexibility: 0.75, historyTicks: 40, bodyBank: 1, headFollow: 1,
	vertical: 1, wave: 1,
})

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number(value)))
const response = (flexibility: number) => 0.15 + (1 - clamp(flexibility, 0, 1)) * 0.65

export function compileProceduralMotion(project: ProjectProceduralMotion, groups: any[]): RuntimeProceduralMotion | undefined {
	if (!project?.enabled) return undefined
	const byUuid = new Map(groups.map(group => [group.uuid, group]))
	const bone = (uuid: string | undefined, label: string) => {
		if (!uuid) return undefined
		const group = byUuid.get(uuid)
		if (!group) throw new Error(`${label} contains a missing bone`)
		return safeFunctionName(group.name)
	}
	const list = (uuids: string[], label: string) => uuids.map(uuid => bone(uuid, label)!)
	const used = [project.root, project.body, project.head, ...project.neck, ...project.tail].filter(Boolean) as string[]
	if (new Set(used).size !== used.length) throw new Error('Procedural Motion contains the same bone twice')
	const vanilla = project.preset === 'vanilla_ender_dragon'
	const historyTicks = vanilla ? 64 : Math.round(clamp(project.historyTicks ?? 40, 2, 64))
	const vertical = clamp(project.vertical ?? 1, 0, 2)
	const wave = clamp(project.wave ?? 1, 0, 2)
	const rootName = bone(project.root, 'Root bone')
	const bodyName = bone(project.body, 'Body bone')
	const headName = bone(project.head, 'Head bone')
	const neckBones = list(project.neck || [], 'Neck chain')
	const tailBones = list(project.tail || [], 'Tail chain')
	const root = rootName ? {
		bone: rootName, sampleDelay: 0, referenceDelay: vanilla ? 7 : 4,
		verticalSampleDelay: vanilla ? 5 : 0, verticalReferenceDelay: vanilla ? 10 : 4,
		yawInfluence: 1, verticalInfluence: (vanilla ? 10 : 5) * vertical, rollInfluence: 0,
		follow: 1, response: vanilla ? 1 : 0.65,
	} : undefined
	const body = bodyName ? {
		bone: bodyName, sampleDelay: vanilla ? 5 : 0, referenceDelay: vanilla ? 10 : 4,
		yawInfluence: 0, verticalInfluence: 0, rollInfluence: -(vanilla ? 1.5 : 0.8) * clamp(project.bodyBank ?? 1, 0, 2),
		follow: 1, response: vanilla ? 1 : 0.65,
	} : undefined
	const head = headName ? {
		bone: headName, sampleDelay: 0, referenceDelay: vanilla ? 6 : 1,
		yawInfluence: (vanilla ? 1 : 1.1) * clamp(project.headFollow ?? 1, 0, 2),
		verticalInfluence: (vanilla ? 0 : 5) * vertical, rollInfluence: vanilla ? -1 : 0.2,
		...(vanilla ? { rollReferenceStartDelay: 5, rollReferenceEndDelay: 10, rollReferenceBlend: -.5 } : {}),
		follow: 1, response: vanilla ? 1 : 0.7,
	} : undefined
	const chain = (bones: string[], kind: 'neck' | 'tail'): MotionChain | undefined => {
		if (!bones.length) return undefined
		const follow = vanilla ? 1 : clamp(kind === 'neck' ? project.neckFollow : project.tailFollow, 0, 2)
		const flexibility = clamp(kind === 'neck' ? project.neckFlexibility : project.tailFlexibility, 0, 1)
		if (vanilla && kind === 'neck') return { bones, startDelay: 5, endDelay: 1, referenceDelay: 6,
			yawInfluence: 1.5, verticalInfluence: 7.5 * vertical, rollInfluence: -1.5,
			rollReferenceStartDelay: 5, rollReferenceEndDelay: 10, rollReferenceBlend: -.5,
			follow, response: 1, waveAmplitude: 0, waveFrequency: 0 }
		if (vanilla) return { bones, startDelay: 12, endDelay: 23, referenceDelay: 11,
			yawInfluence: 1.5, verticalInfluence: 7.5 * vertical, rollInfluence: 1.5,
			rollReferenceStartDelay: 5, rollReferenceEndDelay: 10, rollReferenceBlend: -.5,
			follow, response: 1, waveAmplitude: 0, waveFrequency: 0 }
		return kind === 'neck'
			? { bones, startDelay: 2, endDelay: 10, referenceDelay: 4, yawInfluence: 1.1,
				verticalInfluence: 5 * vertical, rollInfluence: 0.25, follow, response: response(flexibility),
				waveAmplitude: 1.25 * wave, waveFrequency: 0.35 }
			: { bones, startDelay: 2, endDelay: 28, referenceDelay: 0, yawInfluence: 1.35,
				verticalInfluence: 5 * vertical, rollInfluence: 0.4, follow, response: response(flexibility),
				waveAmplitude: 2.5 * wave, waveFrequency: 0.4 }
	}
	const neck = chain(neckBones, 'neck'), tail = chain(tailBones, 'tail')
	const frame = project.bodyFrame
	const bodyFrame = frame && {
		anchor: bone(frame.anchor, 'Body frame anchor')!,
		targets: list(frame.targets, 'Body frame targets'),
		pivot: frame.pivot,
	}
	return { preset: project.preset, historyTicks, ...(vanilla ? { phaseSource: 'native' as const } : {}),
		...(root ? { root } : {}), ...(body ? { body } : {}), ...(head ? { head } : {}),
		...(neck ? { neck } : {}), ...(tail ? { tail } : {}), ...(bodyFrame ? { bodyFrame } : {}) }
}

export const wrapDegrees = (value: number) => {
	value %= 360
	if (value >= 180) value -= 360
	if (value < -180) value += 360
	return value
}

type Entry = MotionBone & { u: number, waveAmplitude: number, waveFrequency: number }

export type ProceduralTelemetry = { bone: string, delay: number, rotation: number[] }

/** Propagate authored rest segments through each bone's absolute procedural ZYX rotation. */
export function solveChainPivots(bones: string[], telemetry: ProceduralTelemetry[], restPivots: number[][],
	anchor: number[] = restPivots[0]): number[][] {
	if (bones.length !== restPivots.length) throw new Error('Procedural chain geometry does not match its bone list')
	const rotations = new Map(telemetry.map(entry => [entry.bone, entry.rotation]))
	const result = bones.map(() => [0, 0, 0]); if (!bones.length) return result
	result[0] = [...anchor]
	for (let index = 0; index + 1 < bones.length; index++) {
		const vector = restPivots[index + 1].map((value, axis) => value - restPivots[index][axis])
		const [x, y] = (rotations.get(bones[index]) || [0, 0, 0]).map(value => value * Math.PI / 180)
		let [vx, vy, vz] = vector
		;[vy, vz] = [vy * Math.cos(x) - vz * Math.sin(x), vy * Math.sin(x) + vz * Math.cos(x)]
		;[vx, vz] = [vx * Math.cos(y) + vz * Math.sin(y), -vx * Math.sin(y) + vz * Math.cos(y)]
		result[index + 1] = [result[index][0] + vx, result[index][1] + vy, result[index][2] + vz]
	}
	return result
}

/** Deterministic preview/oracle implementation of the Java solver contract. */
export class ProceduralMotionSimulation {
	private yaw: number[]
	private y: number[]
	private entries: Entry[]
	private rotations: number[][]
	private tick = 0

	constructor(public config: RuntimeProceduralMotion, yaw = 0, y = 0) {
		this.yaw = Array(config.historyTicks + 1).fill(wrapDegrees(yaw))
		this.y = Array(config.historyTicks + 1).fill(y)
		this.entries = []
		const addBone = (value?: MotionBone) => value && this.entries.push({ ...value, u: 0, waveAmplitude: 0, waveFrequency: 0 })
		const addChain = (value?: MotionChain) => value?.bones.forEach((bone, index) => {
			const u = value.bones.length === 1 ? 0.5 : index / (value.bones.length - 1)
			this.entries.push({ ...value, bone, sampleDelay: value.startDelay + (value.endDelay - value.startDelay) * u, u })
		})
		addBone(config.root); addBone(config.body); addChain(config.neck); addChain(config.tail); addBone(config.head)
		this.rotations = this.entries.map(() => [0, 0, 0])
	}

	reset(yaw = 0, y = 0) {
		this.yaw.fill(wrapDegrees(yaw)); this.y.fill(y); this.rotations.forEach(value => value.fill(0)); this.tick = 0
	}

	advance(yaw: number, y: number, active = true, nativePhase?: number) {
		this.yaw.unshift(wrapDegrees(yaw)); this.yaw.length = this.config.historyTicks + 1
		this.y.unshift(y); this.y.length = this.config.historyTicks + 1; this.tick++
		this.entries.forEach((entry, index) => {
			const sampleYaw = this.sample(this.yaw, entry.sampleDelay, true)
			const referenceYaw = this.sample(this.yaw, entry.referenceDelay, true)
			const vertical = this.sample(this.y, entry.verticalSampleDelay ?? entry.sampleDelay)
				- this.sample(this.y, entry.verticalReferenceDelay ?? entry.referenceDelay)
			const turn = wrapDegrees(sampleYaw - referenceYaw)
			const rollStart = this.sample(this.yaw, entry.rollReferenceStartDelay ?? entry.referenceDelay, true)
			const rollEnd = this.sample(this.yaw, entry.rollReferenceEndDelay ?? entry.referenceDelay, true)
			const rollReference = wrapDegrees(rollStart + wrapDegrees(rollEnd - rollStart) * (entry.rollReferenceBlend ?? 0))
			const roll = wrapDegrees(sampleYaw - rollReference)
			const phase = this.config.phaseSource === 'native'
				? (nativePhase ?? (this.tick / 20 % 1)) * Math.PI * 2 : this.tick * entry.waveFrequency
			const wave = active ? entry.waveAmplitude * Math.sin(phase - entry.u * Math.PI * 2) : 0
			const target = active ? [(vertical * entry.verticalInfluence + wave) * entry.follow,
				turn * entry.yawInfluence * entry.follow, roll * entry.rollInfluence * entry.follow] : [0, 0, 0]
			for (let axis = 0; axis < 3; axis++) this.rotations[index][axis] += wrapDegrees(target[axis] - this.rotations[index][axis]) * entry.response
		})
		return this.telemetry()
	}

	private sample(values: number[], delay: number, wrapped = false) {
		const low = Math.floor(delay), fraction = delay - low
		const start = values[Math.min(low, values.length - 1)], end = values[Math.min(low + 1, values.length - 1)]
		return wrapped ? wrapDegrees(start + wrapDegrees(end - start) * fraction) : start + (end - start) * fraction
	}

	telemetry(): ProceduralTelemetry[] {
		return this.entries.map((entry, index) => ({ bone: entry.bone, delay: entry.sampleDelay, rotation: [...this.rotations[index]] }))
	}
}
