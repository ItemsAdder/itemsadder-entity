import assert from 'assert'
import { animationLayerSettings, isLocomotionAnimation, locomotionStrideSettings, nonDefaultAnimationLayerSettings, normalizeModelEngineDefaultStates, semanticDriverSettings } from './animationSettings'

assert.deepEqual(animationLayerSettings({}), { layer: 'base', priority: 0, blendIn: 0, blendOut: 0 })
assert.deepEqual(nonDefaultAnimationLayerSettings({ layer: 'upper_body', priority: 4, blendIn: 0.2, blendOut: 0.3 }), {
	layer: 'upper_body', priority: 4, blendIn: 0.2, blendOut: 0.3,
})
assert.throws(() => animationLayerSettings({ layer: 'Upper Body' }))
assert.throws(() => animationLayerSettings({ priority: 1.5 }))
assert.throws(() => animationLayerSettings({ priority: 1_000_001 }))
assert.throws(() => animationLayerSettings({ blendIn: -1 }))
assert.throws(() => animationLayerSettings({ blendOut: 61 }))
assert.equal(isLocomotionAnimation({ name: 'walk', animType: 'other' }), false)
assert.equal(isLocomotionAnimation({ name: 'walk' }), true)
assert.equal(isLocomotionAnimation({ name: 'action', animType: 'fly' }), true)
assert.deepEqual(locomotionStrideSettings({ name: 'walk', strideDistance: 2.4 }), { strideDistance: 2.4 })
assert.deepEqual(locomotionStrideSettings({ name: 'idle' }), {})
assert.throws(() => locomotionStrideSettings({ name: 'walk' }))
assert.throws(() => locomotionStrideSettings({ animType: 'fly', strideDistance: 0 }))
assert.deepEqual(locomotionStrideSettings({ animType: 'walk', locomotionMode: 'elapsed', restOnStop: true }), { locomotionMode: 'elapsed', restOnStop: true })

const untouchedGoblin: any[] = [{ name: 'pose' }, { name: 'walk' }]
normalizeModelEngineDefaultStates(untouchedGoblin)
assert.deepEqual(untouchedGoblin.map(({ name, animType, locomotionMode, restOnStop }) => ({ name, animType, locomotionMode, restOnStop })), [
	{ name: 'pose', animType: 'other', locomotionMode: undefined, restOnStop: undefined },
	{ name: 'walk', animType: 'walk', locomotionMode: 'elapsed', restOnStop: 'true' },
])
const explicitIdleWalk: any[] = [{ name: 'idle' }, { name: 'walk' }]
normalizeModelEngineDefaultStates(explicitIdleWalk)
assert.equal(explicitIdleWalk[0].animType, 'idle'); assert.equal(explicitIdleWalk[1].restOnStop, undefined)
const walkAndRest: any[] = [{ name: 'walk' }]
normalizeModelEngineDefaultStates(walkAndRest)
assert.equal(walkAndRest[0].restOnStop, 'true')
const unrelatedPose: any[] = [{ name: 'pose' }]
normalizeModelEngineDefaultStates(unrelatedPose)
assert.deepEqual(unrelatedPose, [{ name: 'pose', animType: 'other' }])
assert.deepEqual(semanticDriverSettings({ layer: 'semantics', semanticDriver: 'attack_progress' }), { semanticDriver: 'attack_progress' })
assert.deepEqual(semanticDriverSettings({ layer: 'semantics', semanticDriver: 'age', loop: 'loop', semanticPeriod: 2 * Math.PI / Math.fround(.067) }), {
	semanticDriver: 'age', semanticPeriod: 2 * Math.PI / Math.fround(.067),
})
assert.deepEqual(semanticDriverSettings({}), {})
assert.throws(() => semanticDriverSettings({ layer: 'semantics', semanticDriver: 'zombie' }))
assert.throws(() => semanticDriverSettings({ semanticDriver: 'aggressive' }))
assert.throws(() => semanticDriverSettings({ layer: 'semantics', semanticDriver: 'age', loop: 'loop' }))
assert.throws(() => semanticDriverSettings({ layer: 'semantics', semanticDriver: 'age', semanticPeriod: 0 }))
assert.throws(() => semanticDriverSettings({ layer: 'semantics', semanticDriver: 'aggressive', semanticPeriod: 20 }))
assert.throws(() => semanticDriverSettings({ semanticPeriod: 20 }))
