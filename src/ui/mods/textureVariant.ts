import { format as modelFormat } from '../../modelFormat'
import { store } from '../../util/store'
import { bus } from '../../util/bus'
import events from '../../constants/events'
import { sampleTextureVariant, textureVariants, DEFAULT_TEXTURE_VARIANT } from '../../textureVariant'
import { applyVariantPreview } from '../panel/states'
import { settings } from '../../settings'

declare const EffectAnimator: any
declare const KeyframeDataPoint: any
declare const Property: any
declare const Format: any
declare const Animation: any
declare const Animator: any
declare const Timeline: any

let property: any
let previousChannel: any
let originalPreview: any
let patchedPreview: any
let previewVariant: string | undefined
let variantNames: string[] = []
export function registerTextureVariantMod() {
	if (property) return
	const choices = document.createElement('datalist')
	choices.id = 'ia_texture_variants'
	document.body.append(choices)
	const refreshVariants = () => {
		variantNames = textureVariants(store.get('states'))
		choices.replaceChildren(...[DEFAULT_TEXTURE_VARIANT, ...variantNames].map(value => Object.assign(document.createElement('option'), { value })))
		previewVariant = undefined
	}
	const bindDropdown = () => document.querySelector('#keyframe_bar_variant input')?.setAttribute('list', choices.id)
	const observer = new MutationObserver(bindDropdown)
	observer.observe(document.body, { childList: true, subtree: true })
	refreshVariants()
	previousChannel = (EffectAnimator as any).prototype.channels.texture_variant
	;(EffectAnimator as any).prototype.channels.texture_variant = {
		name: 'Texture variant', mutable: true, max_data_points: 1,
		condition: () => Format.id === modelFormat.id && settings.iaentitymodel.entityFormat === 'v2',
	}
	property = new Property(KeyframeDataPoint, 'enum', 'variant', {
		default: DEFAULT_TEXTURE_VARIANT,
		condition: (point: any) => Format.id === modelFormat.id && settings.iaentitymodel.entityFormat === 'v2' && point.keyframe.channel === 'texture_variant',
	})
	originalPreview = Animator.preview
	patchedPreview = function (...args: any[]) {
		bus.dispatch('v2_animation_preview_before', {})
		const result = originalPreview.apply(this, args)
		if (Format.id === modelFormat.id && settings.iaentitymodel.entityFormat === 'v2') {
			const animation: any = Animation.selected
			const variant = sampleTextureVariant(animation?.animators?.effects?.keyframes || [], Timeline.time, variantNames)
			if (variant !== previewVariant) {
				previewVariant = variant
				applyVariantPreview(variant)
			}
		}
		bus.dispatch('v2_animation_preview', {})
		return result
	}
	Animator.preview = patchedPreview
	const unregisterLoad = bus.on(events.LIFECYCLE.LOAD_MODEL, refreshVariants)
	const unregisterStates = bus.on('variant_states_changed', refreshVariants)
	const unregisterPreview = bus.on('variant_preview_invalidated', () => { previewVariant = undefined })
	bus.on(events.LIFECYCLE.CLEANUP, () => {
		unregisterLoad(); unregisterStates(); unregisterPreview()
		observer.disconnect(); choices.remove()
		property?.delete(); property = undefined
		if (previousChannel === undefined) delete (EffectAnimator as any).prototype.channels.texture_variant
		else (EffectAnimator as any).prototype.channels.texture_variant = previousChannel
		if (Animator.preview === patchedPreview) Animator.preview = originalPreview
		previewVariant = undefined
	})
}
