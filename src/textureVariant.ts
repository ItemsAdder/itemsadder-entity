const NAME = /^[a-z0-9_-]{1,64}$/
export const DEFAULT_TEXTURE_VARIANT = 'default'
export const MAX_TEXTURE_VARIANTS = 256

export function textureVariants(states: Record<string, unknown> | undefined): string[] {
	const variants = Object.keys(states || {}).filter(name => name !== DEFAULT_TEXTURE_VARIANT)
	if (variants.some(name => !NAME.test(name))) throw new Error('Texture variant names must match [a-z0-9_-]{1,64}')
	variants.sort()
	if (variants.length > MAX_TEXTURE_VARIANTS) throw new Error('Too many texture variants')
	return variants
}

export function sampleTextureVariant(keyframes: any[], time: number, variants: readonly string[]): string {
	if (!Number.isFinite(time) || time < 0) throw new Error('Texture variant sample time must be finite and non-negative')
	let selected = DEFAULT_TEXTURE_VARIANT
	let selectedTime = -Infinity
	for (const keyframe of keyframes) {
		const variant = keyframe?.data_points?.[0]?.variant
		if (keyframe?.channel !== 'texture_variant') continue
		if (!Number.isFinite(keyframe.time) || keyframe.time < 0) throw new Error('Texture variant keyframe time must be finite and non-negative')
		if (variant !== DEFAULT_TEXTURE_VARIANT && !variants.includes(variant)) throw new Error(`Unknown texture variant: ${variant}`)
		// Greatest applicable time wins; later source entry wins an exact-time tie.
		if (keyframe.time <= time && keyframe.time >= selectedTime) {
			selected = variant
			selectedTime = keyframe.time
		}
	}
	return selected
}

export function sampleTextureVariantFrames(keyframes: any[], length: number, variants: readonly string[]): string[] {
	if (!Number.isFinite(length) || length < 0 || length > 3600) throw new Error('Texture variant animation length must be finite and at most one hour')
	return Array.from({ length: Math.ceil(length * 20) + 1 }, (_, frame) => sampleTextureVariant(keyframes, Math.min(frame / 20, length), variants))
}
