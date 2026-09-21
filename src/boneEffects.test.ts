import assert from 'assert'
import { sampleBoneEffects, sampleBoneEffectTracks } from './boneEffects'

const keyframes = [
	{ channel: 'visibility', time: 0.1, data_points: [{ target_bone: 'root', visibility: 'hidden' }] },
	{ channel: 'visibility', time: 0.1, data_points: [{ target_bone: 'root', visibility: 'visible' }] },
	{ channel: 'visibility', time: 0.2, data_points: [{ target_bone: 'root', visibility: 'release' }] },
	{ channel: 'tint', time: 0.05, data_points: [{ target_bone: 'tip', tint: '#12AbEF' }] },
	{ channel: 'tint', time: 0.15, data_points: [{ target_bone: 'tip', tint: 'release' }] },
]
assert.deepEqual(sampleBoneEffects(keyframes, 0, ['root', 'tip']), { visibility: {}, tint: {} })
assert.deepEqual(sampleBoneEffects(keyframes, 0.1, ['root', 'tip']), { visibility: { root: true }, tint: { tip: 0x12abef } })
assert.deepEqual(sampleBoneEffects(keyframes, 0.2, ['root', 'tip']), { visibility: { root: null }, tint: { tip: -1 } })

const tracks = sampleBoneEffectTracks(keyframes, 0.21, ['root', 'tip'])
assert.equal(tracks.visibility.root.length, 6)
assert.deepEqual(tracks.visibility.root, [null, null, true, true, null, null])
assert.deepEqual(tracks.tint.tip, [-1, 0x12abef, 0x12abef, -1, -1, -1])
assert.throws(() => sampleBoneEffects([{ channel: 'visibility', time: 0, data_points: [{ target_bone: 'missing', visibility: 'visible' }] }], 0, ['root']))
assert.throws(() => sampleBoneEffects([{ channel: 'tint', time: NaN, data_points: [] }], 0, ['root']))
assert.throws(() => sampleBoneEffects([{ channel: 'tint', time: 0, data_points: [{ target_bone: 'root', tint: 'red' }] }], 0, ['root']))
