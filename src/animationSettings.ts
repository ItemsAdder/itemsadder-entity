const LAYER = /^[a-z0-9_-]{1,64}$/
const MAX_SEMANTIC_PERIOD = 1_000_000

export type AnimationLayerSettings = { layer: string; priority: number; blendIn: number; blendOut: number }
export type SemanticDriver = 'age' | 'aggressive' | 'attack_progress'

const SEMANTIC_DRIVERS = new Set<SemanticDriver>(['age', 'aggressive', 'attack_progress'])

const LOCOMOTION_TYPES = new Set(['walk', 'walk_angry', 'sneak_walk', 'fly'])
const LOCOMOTION_NAMES = new Set(['walk', 'walking', 'walk_angry', 'sneak_walk', 'fly', 'flying'])

/** Preserve ModelEngine's configured default-state contract while importing foreign projects. */
export function normalizeModelEngineDefaultStates(animations: any[]): void {
	const inferred = new Set<any>()
	for (const animation of animations) {
		if (animation.animType !== undefined) continue
		if (animation.name === 'idle' || animation.name === 'walk') {
			animation.animType = animation.name
			animation.blendIn ??= .25
			animation.blendOut ??= .25
			inferred.add(animation)
		} else animation.animType = 'other'
	}
	const hasIdle = animations.some(animation => animation.animType === 'idle')
	for (const animation of animations) if (inferred.has(animation) && animation.animType === 'walk') {
		animation.locomotionMode = 'elapsed'
		animation.restOnStop = !hasIdle ? 'true' : undefined
	}
}

export function isLocomotionAnimation(animation: any): boolean {
	return animation?.animType === undefined
		? LOCOMOTION_NAMES.has(animation?.name)
		: LOCOMOTION_TYPES.has(animation.animType)
}

export function locomotionStrideSettings(animation: any): { strideDistance?: number; locomotionMode?: 'elapsed'; restOnStop?: true } {
	if (!isLocomotionAnimation(animation)) return {}
	if (animation?.locomotionMode === 'elapsed') {
		if (animation.strideDistance !== undefined) throw new Error('Elapsed locomotion must not declare a stride distance')
		return { locomotionMode: 'elapsed', ...((animation.restOnStop === true || animation.restOnStop === 'true') ? { restOnStop: true } : {}) }
	}
	const value = animation?.strideDistance
	if (!Number.isFinite(value) || value <= 0) throw new Error('Locomotion stride distance must be a positive number')
	return { strideDistance: value }
}

export function animationLayerSettings(animation: any): AnimationLayerSettings {
	const layer = animation?.layer || 'base'
	const priority = animation?.priority ?? 0
	const blendIn = animation?.blendIn ?? 0
	const blendOut = animation?.blendOut ?? 0
	if (typeof layer !== 'string' || !LAYER.test(layer)) throw new Error('Animation layer must match [a-z0-9_-]{1,64}')
	if (!Number.isInteger(priority) || priority < -1_000_000 || priority > 1_000_000) throw new Error('Animation priority must be an integer from -1000000 to 1000000')
	if (!Number.isFinite(blendIn) || blendIn < 0 || blendIn > 60 || !Number.isFinite(blendOut) || blendOut < 0 || blendOut > 60) {
		throw new Error('Animation blend times must be from 0 to 60 seconds')
	}
	return { layer, priority, blendIn, blendOut }
}

export function nonDefaultAnimationLayerSettings(animation: any): Partial<AnimationLayerSettings> {
	const settings = animationLayerSettings(animation)
	return {
		...(settings.layer !== 'base' ? { layer: settings.layer } : {}),
		...(settings.priority !== 0 ? { priority: settings.priority } : {}),
		...(settings.blendIn !== 0 ? { blendIn: settings.blendIn } : {}),
		...(settings.blendOut !== 0 ? { blendOut: settings.blendOut } : {}),
	}
}

export function semanticDriverSettings(animation: any): { semanticDriver?: SemanticDriver; semanticPeriod?: number } {
	const semanticDriver = animation?.semanticDriver
	const semanticPeriod = animation?.semanticPeriod
	if (semanticDriver === undefined || semanticDriver === '' || semanticDriver === 'none') {
		if (semanticPeriod !== undefined) throw new Error('Semantic period requires the age driver')
		return {}
	}
	if (!SEMANTIC_DRIVERS.has(semanticDriver)) throw new Error('Unknown semantic animation driver')
	if (animationLayerSettings(animation).layer === 'base') throw new Error('Semantic animation drivers require a non-base layer')
	if (semanticPeriod !== undefined && (semanticDriver !== 'age' || !Number.isFinite(semanticPeriod)
		|| semanticPeriod <= 0 || semanticPeriod > MAX_SEMANTIC_PERIOD)) throw new Error('Semantic period must be greater than 0 and at most 1000000 age ticks')
	if (semanticDriver === 'age' && animation?.loop === 'loop' && semanticPeriod === undefined)
		throw new Error('Looped age animations require a semantic period')
	return { semanticDriver, ...(semanticPeriod !== undefined ? { semanticPeriod } : {}) }
}
