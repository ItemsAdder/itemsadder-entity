import assert from 'assert'
import { sampleTextureVariant, sampleTextureVariantFrames, textureVariants } from './textureVariant'
const variants = textureVariants({ default: {}, blink: {}, angry: {} })
assert.deepEqual(variants, ['angry', 'blink'])
assert.deepEqual(sampleTextureVariantFrames([
	{ channel: 'texture_variant', time: .05, data_points: [{ variant: 'blink' }] },
	{ channel: 'texture_variant', time: .10, data_points: [{ variant: 'default' }] },
], .1, variants), ['default', 'blink', 'default'])
assert.equal(sampleTextureVariant([
	{ channel: 'texture_variant', time: .10, data_points: [{ variant: 'default' }] },
	{ channel: 'texture_variant', time: .05, data_points: [{ variant: 'blink' }] },
], .075, variants), 'blink')
assert.equal(sampleTextureVariant([
	{ channel: 'texture_variant', time: .05, data_points: [{ variant: 'blink' }] },
	{ channel: 'texture_variant', time: .05, data_points: [{ variant: 'angry' }] },
], .05, variants), 'angry')
assert.deepEqual(sampleTextureVariantFrames([{ channel: 'texture_variant', time: .075, data_points: [{ variant: 'blink' }] }], .075, variants), ['default', 'default', 'blink'])
assert.throws(() => sampleTextureVariant([{ channel: 'texture_variant', time: 0, data_points: [{ variant: 'missing' }] }], 0, variants))
assert.throws(() => sampleTextureVariant([{ channel: 'texture_variant', time: -1, data_points: [{ variant: 'blink' }] }], 0, variants))
assert.throws(() => textureVariants(Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`v${i}`, {}]))))
