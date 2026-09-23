import assert from "assert"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { decodeEntityV2, encodeEntityV2 } from "./EntityV2Codec"
import { compileProceduralMotion, defaultProceduralMotion, ProceduralMotionSimulation, solveChainPivots } from "../proceduralMotion"

const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/iae2-v2.json"), "utf8"))
const encoded = encodeEntityV2(golden)
const document = decodeEntityV2(encoded)
assert.equal(document.matrices.length, 24)
assert.equal(document.matrices[21], 2)
assert.deepEqual(Array.from(encodeEntityV2(document)), Array.from(encoded))
const markerLoop = JSON.parse(JSON.stringify(golden))
Object.assign(markerLoop.metadata.animations[0], { loopMode: 'loop', loopStartTime: 0, loopEndTime: .05 })
assert.doesNotThrow(() => encodeEntityV2(markerLoop))
Object.assign(markerLoop.metadata.animations[0], { loopStartTime: .001, loopEndTime: .049 })
assert.throws(() => encodeEntityV2(markerLoop))
const highRate = JSON.parse(JSON.stringify(golden))
const highRateAnimation = highRate.metadata.animations[0]
highRateAnimation.sampleRate = 400
highRateAnimation.tracks.root = Array(21).fill(0)
highRateAnimation.effects.sounds.keyframes = Array.from({ length: 21 }, () => [])
highRateAnimation.effects.particles.keyframes = Array.from({ length: 21 }, () => [])
assert.equal(decodeEntityV2(encodeEntityV2(highRate)).metadata.animations[0].sampleRate, 400)
highRateAnimation.tracks.root.pop()
assert.throws(() => encodeEntityV2(highRate))
for (const sampleRate of [0, 1.5, 1001, Infinity]) {
	const invalidRate = JSON.parse(JSON.stringify(golden)); invalidRate.metadata.animations[0].sampleRate = sampleRate
	assert.throws(() => encodeEntityV2(invalidRate))
}
assert.throws(() => decodeEntityV2(encoded.subarray(0, -1)))
const malformedUtf8 = encoded.slice(); malformedUtf8[16] = 0xC3
assert.throws(() => decodeEntityV2(malformedUtf8))
assert.throws(() => encodeEntityV2({ metadata: { ...document.metadata, matrixCount: 3 }, matrices: document.matrices }))
const unsupportedPivot = JSON.parse(JSON.stringify(golden)); unsupportedPivot.metadata.bones[0].boneType = 'leftHandPivot'
assert.throws(() => encodeEntityV2(unsupportedPivot))
assert.throws(() => encodeEntityV2({ metadata: { ...golden.metadata, hitbox: { pos: [0, 0, 0], size: [1, 1, 1] } }, matrices: golden.matrices }))

const locomotion = JSON.parse(JSON.stringify(golden)); locomotion.metadata.animations[0].name = 'walk'
assert.doesNotThrow(() => encodeEntityV2(locomotion))
locomotion.metadata.animations[0].animType = 'walk'
assert.throws(() => encodeEntityV2(locomotion))
locomotion.metadata.animations[0].strideDistance = 2 * Math.PI / (0.6662 * 4)
assert.doesNotThrow(() => encodeEntityV2(locomotion))
locomotion.metadata.animations[0].strideDistance = 0
assert.throws(() => encodeEntityV2(locomotion))
locomotion.metadata.animations[0].name = 'idle'; locomotion.metadata.animations[0].animType = 'other'; locomotion.metadata.animations[0].strideDistance = 1
assert.throws(() => encodeEntityV2(locomotion))
const elapsed = JSON.parse(JSON.stringify(golden)); Object.assign(elapsed.metadata.animations[0], {
	name: 'walk', animType: 'walk', locomotionMode: 'elapsed', restOnStop: true,
})
assert.doesNotThrow(() => encodeEntityV2(elapsed))
elapsed.metadata.animations[0].strideDistance = 1
assert.throws(() => encodeEntityV2(elapsed))
delete elapsed.metadata.animations[0].strideDistance; elapsed.metadata.animations[0].animType = 'other'
assert.throws(() => encodeEntityV2(elapsed))

const textured = JSON.parse(JSON.stringify(golden))
textured.metadata.variants = ['blink']
textured.metadata.animations[0].effects.texture_variant = { keyframes: Array(textured.metadata.animations[0].tracks.root.length).fill('blink') }
assert.equal(decodeEntityV2(encodeEntityV2(textured)).metadata.variants[0], 'blink')
textured.metadata.animations[0].effects.texture_variant.keyframes[0] = 'missing'
assert.throws(() => encodeEntityV2(textured))
const unsorted = JSON.parse(JSON.stringify(golden))
unsorted.metadata.variants = ['blink', 'angry']
assert.throws(() => encodeEntityV2(unsorted))
assert.throws(() => encodeEntityV2({ ...golden, matrices: golden.matrices.map((value: number, index: number) => index ? value : 1e100) }))

const numeric = JSON.parse(JSON.stringify(golden))
numeric.metadata.extensions = { numbers: { zero: -0, one: 1.0, tiny: 1e-7, large: 1e21 } }
const numericEncoded = encodeEntityV2(numeric)
const numericJsonLength = new DataView(numericEncoded.buffer, numericEncoded.byteOffset, numericEncoded.byteLength).getUint32(8, true)
const numericJson = new TextDecoder().decode(numericEncoded.subarray(16, 16 + numericJsonLength))
assert.ok(numericJson.includes('"numbers":{"large":1000000000000000000000,"one":1,"tiny":0.0000001,"zero":0}'))

const flight = JSON.parse(JSON.stringify(golden))
flight.metadata.animations.push({ ...JSON.parse(JSON.stringify(flight.metadata.animations[0])), name: 'fly_turn_left' })
flight.metadata.animations.push({ ...JSON.parse(JSON.stringify(flight.metadata.animations[0])), name: 'fly_turn_right' })
flight.metadata.extensions = { 'itemsadder:flight_blend': {
	straight: flight.metadata.animations[0].name, left: 'fly_turn_left', right: 'fly_turn_right',
	deadzone: 0.5, maxTurnRate: 8, smoothing: 0.35,
} }
assert.deepEqual(decodeEntityV2(encodeEntityV2(flight)).metadata.extensions, flight.metadata.extensions)
const straightOnly = JSON.parse(JSON.stringify(flight)); delete straightOnly.metadata.extensions['itemsadder:flight_blend'].left; delete straightOnly.metadata.extensions['itemsadder:flight_blend'].right
assert.doesNotThrow(() => encodeEntityV2(straightOnly))
const badFlight = (change: (definition: any) => void) => {
	const value = JSON.parse(JSON.stringify(flight)); change(value.metadata.extensions['itemsadder:flight_blend']); assert.throws(() => encodeEntityV2(value))
}
badFlight(value => { value.left = 'missing' })
badFlight(value => { value.maxTurnRate = value.deadzone })
badFlight(value => { value.smoothing = 0 })

const procedural = JSON.parse(JSON.stringify(golden))
procedural.metadata.extensions = { 'itemsadder:procedural_motion': {
	preset: 'vanilla_ender_dragon', historyTicks: 40,
	body: { bone: 'root', sampleDelay: 5, referenceDelay: 10, yawInfluence: 0, verticalInfluence: 0,
		rollInfluence: -1.5, follow: 1, response: 0.7 },
	neck: { bones: [], startDelay: 5, endDelay: 1, referenceDelay: 6, yawInfluence: 1.5,
		verticalInfluence: 7.5, rollInfluence: 1.5, follow: 1, response: 0.7, waveAmplitude: 0, waveFrequency: 0 },
} }
assert.deepEqual(decodeEntityV2(encodeEntityV2(procedural)).metadata.extensions, procedural.metadata.extensions)
const badProcedural = (change: (definition: any) => void) => {
	const value = JSON.parse(JSON.stringify(procedural)); change(value.metadata.extensions['itemsadder:procedural_motion']); assert.throws(() => encodeEntityV2(value))
}
badProcedural(value => { value.body.bone = 'missing' })
badProcedural(value => { value.historyTicks = 65 })
badProcedural(value => { value.body.sampleDelay = 40 })
badProcedural(value => { value.body.response = 0 })
badProcedural(value => { value.tail = { ...value.neck, bones: ['root', 'root'] } })

const groups = Array.from({ length: 21 }, (_, index) => ({ uuid: `bone-${index}`, name: index ? `appendage_${index}` : 'core' }))
const projectMotion = { ...defaultProceduralMotion(), preset: 'custom' as const, body: groups[0].uuid, head: groups[1].uuid,
	tail: groups.slice(2).map(group => group.uuid), tailFollow: 1, tailFlexibility: 0, vertical: 1, wave: 0 }
const runtimeMotion = compileProceduralMotion(projectMotion, groups)!
const preview = new ProceduralMotionSimulation(runtimeMotion)
assert.equal(preview.telemetry().length, 21)
assert.equal(preview.telemetry()[1].delay, 2)
assert.equal(preview.telemetry()[preview.telemetry().length - 2].delay, 28)
let yaw = 0
preview.advance(yaw, 0)
for (let tick = 0; tick < 28; tick++) { yaw -= 8; preview.advance(yaw, tick * 0.1) }
for (let tick = 0; tick < 2; tick++) { yaw += 8; preview.advance(yaw, 2.8 + tick * 0.1) }
const reversal = preview.telemetry()
assert.ok(reversal[reversal.length - 1].rotation[1] > 0, 'head must respond to the new right turn')
assert.ok(reversal[1].rotation[1] < 0, 'tail base must be transitioning through the new turn')
assert.ok(reversal[reversal.length - 2].rotation[1] > 0, 'tail tip must still contain older left-turn history')
assert.notEqual(reversal[reversal.length - 2].rotation[0], 0, 'vertical history must affect chain pitch')

const geometryBones = ['unequal_0', 'unequal_1', 'unequal_2', 'unequal_3']
const flatRest = [[0, 0, 0], [1, 0, 0], [3, 0, 0], [3, 0, 4]]
const nestedSegments = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 4]]
const nestedRest = nestedSegments.map((_, index) => nestedSegments.slice(0, index + 1)
	.reduce((sum, value) => sum.map((entry, axis) => entry + value[axis]), [0, 0, 0]))
assert.deepEqual(nestedRest, flatRest)
const geometryTelemetry = geometryBones.map((bone, index) => ({ bone, delay: index,
	rotation: [index * 2, 12 - index * 7, index * 3] }))
const flatShape = solveChainPivots(geometryBones, geometryTelemetry, flatRest)
const nestedShape = solveChainPivots(geometryBones, geometryTelemetry, nestedRest)
assert.deepEqual(nestedShape, flatShape)
for (const [index, length] of [1, 2, 4].entries())
	assert.ok(Math.abs(Math.hypot(...flatShape[index + 1].map((value, axis) => value - flatShape[index][axis])) - length) < 1e-9)
assert.ok(Math.hypot(...flatShape[3].map((value, axis) => value - flatRest[3][axis])) > .25,
	'flat procedural chains must move downstream pivots, not only rotate fixed joints')

const vanillaOracle = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../ItemsAdder/.tasks/custom-entities-v2/golden/vanilla-ender-dragon-1.21.1.json'), 'utf8'))
const vanillaGroups = Array.from({ length: 19 }, (_, index) => ({ uuid: `vanilla-${index}`, name: `vanilla_${index}` }))
const vanillaMotion = compileProceduralMotion({ ...defaultProceduralMotion(), preset: 'vanilla_ender_dragon',
	body: vanillaGroups[0].uuid, head: vanillaGroups[1].uuid,
	neck: vanillaGroups.slice(2, 7).map(group => group.uuid), tail: vanillaGroups.slice(7).map(group => group.uuid) }, vanillaGroups)!
const exact = vanillaOracle.exactPreset
assert.equal(vanillaMotion.historyTicks, exact.historyTicks)
for (const key of ['sampleDelay', 'referenceDelay', 'yawInfluence', 'verticalInfluence', 'rollInfluence'])
	assert.equal((vanillaMotion.body as any)[key], exact.body[key])
for (const key of ['sampleDelay', 'referenceDelay', 'yawInfluence', 'verticalInfluence', 'rollInfluence'])
	assert.equal((vanillaMotion.head as any)[key], exact.head[key])
for (const chain of ['neck', 'tail'] as const) {
	assert.equal(vanillaMotion[chain]!.bones.length, exact[chain].count)
	for (const key of ['startDelay', 'endDelay', 'referenceDelay', 'yawInfluence', 'verticalInfluence', 'rollInfluence'])
		assert.equal((vanillaMotion[chain] as any)[key], exact[chain][key])
}

const sharedOracle = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../ItemsAdder/.tasks/custom-entities-v2/golden/procedural-motion-v1.json'), 'utf8'))
const sharedConfig = sharedOracle.config
const sharedPreview = new ProceduralMotionSimulation({
	preset: 'custom', historyTicks: sharedConfig.historyTicks,
	body: { bone: 'core', ...sharedConfig.body }, head: { bone: 'sensor', ...sharedConfig.head },
	tail: { bones: Array.from({ length: sharedConfig.tail.count }, (_, index) => `segment_${index}`), ...sharedConfig.tail },
})
for (const [yawSample, ySample] of sharedOracle.samples) sharedPreview.advance(yawSample, ySample)
const sharedResult = sharedPreview.telemetry()
const close = (actual: number[], expected: number[]) => actual.every((value, index) => Math.abs(value - expected[index]) <= sharedOracle.tolerance)
assert.equal(sharedResult.length, sharedOracle.expected.entryCount)
assert.ok(close(sharedResult[1].rotation, sharedOracle.expected.tailBaseRotation))
assert.ok(close(sharedResult[sharedConfig.tail.count].rotation, sharedOracle.expected.tailTipRotation))
assert.ok(close(sharedResult[sharedResult.length - 1].rotation, sharedOracle.expected.headRotation))

const legacy = { metadata: { schema: "iae2", matrixCount: 0, bones: [], animations: [], legacy: { coordinateMode: "armorstand-head-1.21.1", source: {} } }, matrices: [] }
assert.deepEqual(decodeEntityV2(encodeEntityV2(legacy)), legacy)
assert.throws(() => encodeEntityV2({ ...legacy, matrices: new Array(12).fill(0) }))
assert.throws(() => encodeEntityV2({ metadata: { ...legacy.metadata, variants: ['blink'] }, matrices: [] }))
assert.throws(() => encodeEntityV2({ metadata: { ...legacy.metadata, geometryProfiles: {} }, matrices: [] }))
assert.throws(() => encodeEntityV2({ metadata: { ...legacy.metadata, transformSpace: 'local' }, matrices: [] }))
assert.throws(() => encodeEntityV2({ metadata: { ...legacy.metadata, textures: {} }, matrices: [] }))
assert.throws(() => encodeEntityV2({ metadata: { ...legacy.metadata, textureMeta: {} }, matrices: [] }))

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const pngDigest = crypto.createHash('sha256').update(png).digest('hex')
const embedded = JSON.parse(JSON.stringify(golden)); embedded.metadata.textures = { [pngDigest]: png.toString('base64') }
assert.deepEqual(decodeEntityV2(encodeEntityV2(embedded)).metadata.textures, embedded.metadata.textures)
const badEmbedded = (textures: any) => assert.throws(() => encodeEntityV2({ ...embedded, metadata: { ...embedded.metadata, textures } }))
badEmbedded({ [pngDigest.toUpperCase()]: png.toString('base64') })
badEmbedded({ [pngDigest]: ` ${png.toString('base64')}` })
badEmbedded({ ['0'.repeat(64)]: png.toString('base64') })
badEmbedded({ [pngDigest]: Buffer.from('not png').toString('base64') })
badEmbedded(Object.fromEntries(Array.from({ length: 257 }, (_, index) => [index.toString(16).padStart(64, '0'), ''])))
const animatedMeta = { animation: { interpolate: true, frametime: 2 } }
const animatedDigest = crypto.createHash('sha256').update(png).update(Buffer.from([0])).update('{"animation":{"frametime":2,"interpolate":true}}').digest('hex')
const animated = JSON.parse(JSON.stringify(golden)); animated.metadata.textures = { [animatedDigest]: png.toString('base64') }; animated.metadata.textureMeta = { [animatedDigest]: animatedMeta }
assert.deepEqual(decodeEntityV2(encodeEntityV2(animated)).metadata.textureMeta, animated.metadata.textureMeta)
const badAnimated = JSON.parse(JSON.stringify(animated)); badAnimated.metadata.textureMeta[animatedDigest].animation.frametime = 3
assert.throws(() => encodeEntityV2(badAnimated))
const orphanMeta = JSON.parse(JSON.stringify(embedded)); orphanMeta.metadata.textureMeta = { ['0'.repeat(64)]: animatedMeta }
assert.throws(() => encodeEntityV2(orphanMeta))

const geometry = JSON.parse(JSON.stringify(golden))
geometry.metadata.geometryProfiles = {
	compatible: { root: [0] },
	single_axis_45: { root: [0] },
	unrestricted: { root: [0] },
}
assert.deepEqual(decodeEntityV2(encodeEntityV2(geometry)).metadata.geometryProfiles, geometry.metadata.geometryProfiles)
const bundle = JSON.parse(JSON.stringify(geometry))
bundle.metadata.entity = { namespace: 'custom', id: 'dragon', type: 'ENDER_DRAGON', canSunBurn: false }
bundle.metadata.geometryModels = Object.fromEntries(['compatible', 'single_axis_45', 'unrestricted'].map(profile => [profile, {
	root: [{ model: { textures: {}, elements: [] }, variants: {} }],
}]))
assert.deepEqual(decodeEntityV2(encodeEntityV2(bundle)).metadata.entity, bundle.metadata.entity)
const badBundle = JSON.parse(JSON.stringify(bundle)); badBundle.metadata.geometryModels.compatible.root = []
assert.throws(() => encodeEntityV2(badBundle))
const badBundleType = JSON.parse(JSON.stringify(bundle)); badBundleType.metadata.entity.type = 'ender dragon'
assert.throws(() => encodeEntityV2(badBundleType))
const badProfile = JSON.parse(JSON.stringify(geometry)); badProfile.metadata.geometryProfiles.future = { root: [0] }
assert.throws(() => encodeEntityV2(badProfile))
const missingBone = JSON.parse(JSON.stringify(geometry)); delete missingBone.metadata.geometryProfiles.compatible.root
assert.throws(() => encodeEntityV2(missingBone))
const emptyFragments = JSON.parse(JSON.stringify(geometry)); emptyFragments.metadata.geometryProfiles.compatible.root = []
assert.throws(() => encodeEntityV2(emptyFragments))
const badIdentity = JSON.parse(JSON.stringify(geometry)); badIdentity.metadata.geometryProfiles.compatible.root = [1]
assert.throws(() => encodeEntityV2(badIdentity))
const tooManyPerBone = JSON.parse(JSON.stringify(geometry)); tooManyPerBone.metadata.geometryProfiles.compatible.root = Array(257).fill(0)
assert.throws(() => encodeEntityV2(tooManyPerBone))
const unsafeBone = JSON.parse(JSON.stringify(geometry)); unsafeBone.metadata.bones[0].name = '..'
for (const profile of Object.values(unsafeBone.metadata.geometryProfiles) as any[]) { profile['..'] = profile.root; delete profile.root }
unsafeBone.metadata.animations[0].tracks['..'] = unsafeBone.metadata.animations[0].tracks.root; delete unsafeBone.metadata.animations[0].tracks.root
assert.throws(() => encodeEntityV2(unsafeBone))

function manyGeometryBones(count: number, fragments: number) {
	const value = JSON.parse(JSON.stringify(golden))
	value.metadata.bones = Array.from({ length: count }, (_, index) => ({ name: `bone_${index}`, boneType: 'normal', parents: [], staticMatrix: 0, geometryScale: 1 }))
	value.metadata.animations[0].tracks = { bone_0: value.metadata.animations[0].tracks.root }
	value.metadata.geometryProfiles = Object.fromEntries(['compatible', 'single_axis_45', 'unrestricted'].map(profile => [profile,
		Object.fromEntries(value.metadata.bones.map((bone: any) => [bone.name, Array(fragments).fill(0)]))]))
	return value
}
assert.throws(() => encodeEntityV2(manyGeometryBones(33, 256)))
assert.throws(() => encodeEntityV2(manyGeometryBones(22, 250)))

const local = JSON.parse(JSON.stringify(golden))
local.metadata.transformSpace = 'local'
local.metadata.animations[0].affectedBones = ['root']
local.metadata.animations[0].layer = 'upper_body'
local.metadata.animations[0].priority = -4
local.metadata.animations[0].blendIn = 0.2
local.metadata.animations[0].blendOut = 0.3
const localFrames = local.metadata.animations[0].tracks.root.length
local.metadata.animations[0].effects.visibility = { tracks: { root: Array(localFrames).fill(null) } }
local.metadata.animations[0].effects.visibility.tracks.root[1] = false
local.metadata.animations[0].effects.tint = { tracks: { root: Array(localFrames).fill(-1) } }
local.metadata.animations[0].effects.tint.tracks.root[1] = 0x12abef
assert.equal(decodeEntityV2(encodeEntityV2(local)).metadata.transformSpace, 'local')
const semantic = JSON.parse(JSON.stringify(local))
Object.assign(semantic.metadata.animations[0], {
	loopMode: 'loop', semanticDriver: 'age', semanticPeriod: 2 * Math.PI / Math.fround(.067),
})
const semanticBytes = encodeEntityV2(semantic)
assert.deepEqual(Array.from(encodeEntityV2(decodeEntityV2(semanticBytes))), Array.from(semanticBytes))
const badSemantic = (change: (animation: any) => void) => {
	const value = JSON.parse(JSON.stringify(semantic)); change(value.metadata.animations[0]); assert.throws(() => encodeEntityV2(value))
}
badSemantic(animation => { delete animation.semanticPeriod })
badSemantic(animation => { animation.semanticPeriod = 0 })
badSemantic(animation => { animation.semanticPeriod = 1_000_001 })
badSemantic(animation => { animation.semanticDriver = 'aggressive' })
badSemantic(animation => { delete animation.semanticDriver })
const channelLocal = JSON.parse(JSON.stringify(local))
delete channelLocal.metadata.animations[0].affectedBones
channelLocal.metadata.animations[0].channelMasks = [[0, 7]]
const channelBytes = encodeEntityV2(channelLocal)
assert.deepEqual(Array.from(encodeEntityV2(decodeEntityV2(channelBytes))), Array.from(channelBytes))
const badLocal = (change: (value: any) => void) => { const value = JSON.parse(JSON.stringify(local)); change(value); assert.throws(() => encodeEntityV2(value)) }
badLocal(value => { value.metadata.transformSpace = 'future' })
badLocal(value => { value.metadata.animations[0].affectedBones = ['missing'] })
badLocal(value => { value.metadata.animations[0].affectedBones = ['root', 'root'] })
badLocal(value => { value.metadata.animations[0].layer = 'Upper Body' })
badLocal(value => { value.metadata.animations[0].priority = 1.5 })
badLocal(value => { value.metadata.animations[0].blendIn = 61 })
badLocal(value => { value.metadata.animations[0].effects.visibility.tracks.root[0] = 0 })
badLocal(value => { value.metadata.animations[0].effects.tint.tracks.root[0] = 0x1000000 })
badLocal(value => { value.metadata.animations[0].effects.tint.tracks.missing = value.metadata.animations[0].effects.tint.tracks.root })
const badChannels = (masks: unknown) => {
	const value = JSON.parse(JSON.stringify(channelLocal)); value.metadata.animations[0].channelMasks = masks; assert.throws(() => encodeEntityV2(value))
}
badChannels([[0, 0]])
badChannels([[0, 8]])
badChannels([[1, 1]])
badChannels([[0, 1], [0, 2]])
badChannels([[0, 1, 2]])
const ambiguousMask = JSON.parse(JSON.stringify(channelLocal)); ambiguousMask.metadata.animations[0].affectedBones = ['root']
assert.throws(() => encodeEntityV2(ambiguousMask))
const chained = JSON.parse(JSON.stringify(local))
chained.metadata.bones.push(
	{ ...chained.metadata.bones[0], name: 'middle', parents: ['root'] },
	{ ...chained.metadata.bones[0], name: 'tip', parents: ['middle', 'root'] },
)
chained.metadata.animations[0].tracks.middle = chained.metadata.animations[0].tracks.root
chained.metadata.animations[0].tracks.tip = chained.metadata.animations[0].tracks.root
assert.doesNotThrow(() => encodeEntityV2(chained))
const incompleteChain = JSON.parse(JSON.stringify(chained)); incompleteChain.metadata.bones[2].parents = ['middle']
assert.throws(() => encodeEntityV2(incompleteChain))
const unorderedChain = JSON.parse(JSON.stringify(chained)); unorderedChain.metadata.bones[2].parents = ['root', 'middle']
assert.throws(() => encodeEntityV2(unorderedChain))
const deep = JSON.parse(JSON.stringify(local))
const ancestors: string[] = []
for (let depth = 1; depth <= 257; depth++) {
	ancestors.unshift(depth === 1 ? 'root' : `deep_${depth - 1}`)
	deep.metadata.bones.push({ ...deep.metadata.bones[0], name: `deep_${depth}`, parents: ancestors.slice() })
}
assert.throws(() => encodeEntityV2(deep))
const worldAffected = JSON.parse(JSON.stringify(golden)); worldAffected.metadata.animations[0].affectedBones = ['root']
assert.throws(() => encodeEntityV2(worldAffected))
const worldChannels = JSON.parse(JSON.stringify(golden)); worldChannels.metadata.animations[0].channelMasks = [[0, 7]]
assert.throws(() => encodeEntityV2(worldChannels))
const worldBlend = JSON.parse(JSON.stringify(golden)); worldBlend.metadata.animations[0].blendIn = 0.1
assert.throws(() => encodeEntityV2(worldBlend))
worldBlend.metadata.animations[0].blendIn = 0
assert.doesNotThrow(() => encodeEntityV2(worldBlend))

for (const file of process.argv.slice(2)) {
	const bytes = fs.readFileSync(file)
	const exported = decodeEntityV2(bytes)
	assert.deepEqual(Array.from(encodeEntityV2(exported)), Array.from(bytes))
	const masks = Object.fromEntries((exported.metadata.animations as any[]).map(animation => [animation.name, animation.channelMasks]))
	assert.deepEqual(masks, {
		neutral: [[0, 2]], held: [[0, 2], [1, 5], [2, 2]],
		override: [[0, 2]], full: [[0, 7], [1, 7], [2, 7]],
		walk: [[0, 2], [2, 2]], walk_action: [[0, 2]],
	})
	console.log(`Editor export roundtrip and channel masks: PASS ${file}`)
}
