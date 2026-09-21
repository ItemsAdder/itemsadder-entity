import crypto from "crypto"

const MAGIC = "IAE2"
const VERSION = 2
const HEADER_BYTES = 16
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_JSON_BYTES = 16 * 1024 * 1024
const MAX_BONES = 8192
const MAX_ANIMATIONS = 8192
const MAX_TRACK_FRAMES = 1_000_000
const MAX_HIERARCHY_DEPTH = 256
const BONE_TYPES = new Set(["normal", "head", "hatPivot", "leftHandPivot", "rightHandPivot", "mount", "locator"])
const UNSUPPORTED_NATIVE_PIVOTS = new Set(["hatPivot", "leftHandPivot", "rightHandPivot"])
const GEOMETRY_PROFILES = ["compatible", "single_axis_45", "unrestricted"] as const
const LOOP_MODES = new Set(["loop", "once", "hold"])
const ANIMATION_TYPES = new Set(["other", "idle", "idle_angry", "walk", "walk_angry", "jump", "attack", "death", "fly", "sneak", "sneak_walk"])
const SEMANTIC_DRIVERS = new Set(["age", "aggressive", "attack_progress"])
const MAX_SEMANTIC_PERIOD = 1_000_000

export type EntityV2Document = { metadata: Record<string, unknown>; matrices: number[] }

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

export function encodeEntityV2(document: EntityV2Document): Uint8Array {
	validate(document)
	const json = encoder.encode(canonicalJson(document.metadata))
	if (json.length > MAX_JSON_BYTES || HEADER_BYTES + json.length + document.matrices.length * 4 > MAX_FILE_BYTES)
		throw invalid("document too large")
	const output = new Uint8Array(HEADER_BYTES + json.length + document.matrices.length * 4)
	const view = new DataView(output.buffer)
	output.set(encoder.encode(MAGIC), 0)
	view.setUint16(4, VERSION, true)
	view.setUint16(6, 0, true)
	view.setUint32(8, json.length, true)
	view.setUint32(12, document.matrices.length, true)
	output.set(json, HEADER_BYTES)
	document.matrices.forEach((value, index) => view.setFloat32(HEADER_BYTES + json.length + index * 4, value, true))
	return output
}

export function decodeEntityV2(input: Uint8Array): EntityV2Document {
	if (input.length < HEADER_BYTES || input.length > MAX_FILE_BYTES) throw invalid("invalid file length")
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
	if (decoder.decode(input.subarray(0, 4)) !== MAGIC || view.getUint16(4, true) !== VERSION || view.getUint16(6, true) !== 0)
		throw invalid("unsupported header")
	const jsonBytes = view.getUint32(8, true)
	const floatCount = view.getUint32(12, true)
	if (jsonBytes > MAX_JSON_BYTES || floatCount % 12 || HEADER_BYTES + jsonBytes + floatCount * 4 !== input.length)
		throw invalid("invalid lengths")
	let metadata: Record<string, unknown>
	try { metadata = JSON.parse(decoder.decode(input.subarray(HEADER_BYTES, HEADER_BYTES + jsonBytes))) } catch { throw invalid("invalid metadata JSON") }
	if (!isObject(metadata)) throw invalid("metadata must be an object")
	const matrices = Array.from({ length: floatCount }, (_, index) => view.getFloat32(HEADER_BYTES + jsonBytes + index * 4, true))
	validate({ metadata, matrices })
	return { metadata, matrices }
}

function validate(document: EntityV2Document): void {
	if (!isObject(document.metadata) || !Array.isArray(document.matrices) || document.matrices.length % 12 || document.matrices.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value))))
		throw invalid("invalid matrix table")
	keys(document.metadata, ["schema", "matrixCount", "bones", "animations"], ["legacy", "hitbox", "extensions", "variants", "geometryProfiles", "transformSpace", "textures", "textureMeta"], "metadata")
	if (document.metadata.schema !== "iae2" || integer(document.metadata.matrixCount, "matrixCount") !== document.matrices.length / 12)
		throw invalid("invalid schema or matrix count")
	if ("legacy" in document.metadata) {
		if ("variants" in document.metadata || "geometryProfiles" in document.metadata || "transformSpace" in document.metadata || "textures" in document.metadata || "textureMeta" in document.metadata) throw invalid("legacy mode cannot contain native fields")
		validateLegacyContainer(object(document.metadata.legacy, "legacy"), document)
		return
	}
	const localTransforms = "transformSpace" in document.metadata
	if (localTransforms && document.metadata.transformSpace !== "local") throw invalid("unknown transform space")
	if ("hitbox" in document.metadata) throw invalid("native V2 custom hitboxes are not supported; use the base entity hitbox")
	if ("extensions" in document.metadata && !isObject(document.metadata.extensions)) throw invalid("extensions must be an object")
	const textureBytes = "textures" in document.metadata ? validateTextures(object(document.metadata.textures, "textures")) : new Map<string, Buffer>()
	validateTextureMeta("textureMeta" in document.metadata ? object(document.metadata.textureMeta, "textureMeta") : {}, textureBytes)
	const variants = "variants" in document.metadata ? array(document.metadata.variants, "variants", 256).map(value => boundedString(value, "variant", false)) : []
	if (variants.some(name => name === "default" || !/^[a-z0-9_-]{1,64}$/.test(name)) || new Set(variants).size !== variants.length) throw invalid("invalid variants")
	if (variants.some((name, index) => index > 0 && variants[index - 1] >= name)) throw invalid("variants must be sorted")
	const bones = array(document.metadata.bones, "bones", MAX_BONES)
	const names = new Set<string>()
	const boneOrder: string[] = []
	const parents = new Map<string, string[]>()
	for (const bone of bones) {
		const boneObject = object(bone, "bone")
		keys(boneObject, ["name", "boneType", "parents", "staticMatrix", "geometryScale"], ["maxHeadRotX", "maxHeadRotY"], "bone")
		const name = string(boneObject.name, "bone.name")
		if (names.has(name)) throw invalid("duplicate bone name")
		const boneType = boundedString(boneObject.boneType, "bone.boneType", false)
		names.add(name); boneOrder.push(name); if (!BONE_TYPES.has(boneType)) throw invalid("unknown bone type"); if (UNSUPPORTED_NATIVE_PIVOTS.has(boneType)) throw invalid(`native V2 equipment pivot is not supported: ${boneType}`); index(boneObject.staticMatrix, document.matrices.length / 12, "bone.staticMatrix")
		if (!(number(boneObject.geometryScale, "bone.geometryScale") > 0)) throw invalid("bone.geometryScale must be positive")
		if ("maxHeadRotX" in boneObject && number(boneObject.maxHeadRotX, "bone.maxHeadRotX") < 0) throw invalid("bone.maxHeadRotX must be non-negative")
		if ("maxHeadRotY" in boneObject && number(boneObject.maxHeadRotY, "bone.maxHeadRotY") < 0) throw invalid("bone.maxHeadRotY must be non-negative")
		const list = array(boneObject.parents, "bone.parents", MAX_BONES).map(value => string(value, "bone.parent"))
		if (list.length > MAX_HIERARCHY_DEPTH) throw invalid("bone hierarchy is too deep")
		if (new Set(list).size !== list.length) throw invalid("duplicate parent")
		parents.set(name, list)
	}
	for (const list of parents.values()) list.forEach(parent => { if (!names.has(parent)) throw invalid("unknown parent") })
	if (localTransforms) parents.forEach(list => {
		if (list.length && JSON.stringify(list.slice(1)) !== JSON.stringify(parents.get(list[0]))) throw invalid("local parent chain is incomplete or unordered")
	})
	const degrees = new Map<string, number>(), children = new Map<string, string[]>()
	names.forEach(name => { degrees.set(name, 0); children.set(name, []) })
	parents.forEach((list, name) => list.forEach(parent => { degrees.set(name, degrees.get(name)! + 1); children.get(parent)!.push(name) }))
	const queue = Array.from(names).filter(name => degrees.get(name) === 0)
	let visited = 0
	for (let offset = 0; offset < queue.length; offset++) {
		const name = queue[offset]; visited++
		children.get(name)!.forEach(child => { const remaining = degrees.get(child)! - 1; degrees.set(child, remaining); if (remaining === 0) queue.push(child) })
	}
	if (visited !== names.size) throw invalid("bone hierarchy cycle")
	if ("geometryProfiles" in document.metadata) validateGeometryProfiles(object(document.metadata.geometryProfiles, "geometryProfiles"), bones, document)
	const animationNames = new Set<string>()
	for (const animation of array(document.metadata.animations, "animations", MAX_ANIMATIONS)) {
		const animationObject = object(animation, "animation")
		if (animationNames.has(string(animationObject.name, "animation.name"))) throw invalid("duplicate animation name")
		animationNames.add(string(animationObject.name, "animation.name"))
		validateAnimation(animationObject, names, boneOrder, document.matrices.length / 12, variants, localTransforms)
	}
}

function validateTextures(textures: Record<string, unknown>): Map<string, Buffer> {
	const entries = Object.entries(textures)
	if (entries.length > 256) throw invalid("too many textures")
	let encodedChars = 0
	const decoded = new Map<string, Buffer>()
	for (const [digest, encoded] of entries) {
		if (!/^[0-9a-f]{64}$/.test(digest) || typeof encoded !== "string" || encoded.length > MAX_JSON_BYTES) throw invalid("invalid embedded texture")
		encodedChars += encoded.length
		if (encodedChars > MAX_JSON_BYTES || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw invalid("invalid embedded texture base64")
		const bytes = Buffer.from(encoded, "base64")
		if (bytes.toString("base64") !== encoded || bytes.length < 24
			|| !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
			|| bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") throw invalid("invalid embedded PNG")
		const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
		if (!width || !height || width > 16384 || height > 16384 || width * height > 16_777_216) throw invalid("embedded PNG dimensions out of bounds")
		decoded.set(digest, bytes)
	}
	return decoded
}

function validateTextureMeta(textureMeta: Record<string, unknown>, textures: Map<string, Buffer>): void {
	for (const [digest, meta] of Object.entries(textureMeta)) {
		const bytes = textures.get(digest)
		if (!bytes || !isObject(meta)) throw invalid("texture metadata must reference an embedded texture")
		const expected = crypto.createHash("sha256").update(bytes).update(Buffer.from([0])).update(canonicalJson(meta)).digest("hex")
		if (expected !== digest) throw invalid("embedded texture digest mismatch")
	}
	for (const [digest, bytes] of textures) if (!textureMeta[digest]
		&& crypto.createHash("sha256").update(bytes).digest("hex") !== digest) throw invalid("embedded texture digest mismatch")
}

function validateGeometryProfiles(profiles: Record<string, unknown>, bones: unknown[], document: EntityV2Document): void {
	keys(profiles, [...GEOMETRY_PROFILES], [], "geometryProfiles")
	const visualBones = bones.map(value => object(value, "bone"))
		.filter(bone => bone.boneType === "normal" || bone.boneType === "head")
		.map(bone => string(bone.name, "bone.name"))
	for (const name of visualBones) if (!/^[a-z0-9._-]+$/.test(name) || name === "." || name === "..") throw invalid("unsafe geometry profile bone name")
	let documentFragments = 0
	for (const profileName of GEOMETRY_PROFILES) {
		const profile = object(profiles[profileName], "geometry profile")
		keys(profile, visualBones, [], "geometry profile bones")
		let profileFragments = 0
		for (const bone of visualBones) {
			const fragments = array(profile[bone], "geometry fragments", 256)
			if (!fragments.length) throw invalid("geometry profile bone has no fragments")
			profileFragments += fragments.length
			documentFragments += fragments.length
			if (profileFragments > 8192 || documentFragments > 16384) throw invalid("too many geometry fragments")
			fragments.forEach(matrix => index(matrix, document.matrices.length / 12, "fragment matrix"))
			const offset = integer(fragments[0], "primary fragment matrix") * 12
			for (let component = 0; component < 12; component++) {
				const expected = component === 0 || component === 4 || component === 8 ? 1 : 0
				if (document.matrices[offset + component] !== expected) throw invalid("primary fragment matrix must be identity")
			}
		}
	}
}

function validateLegacyContainer(legacy: Record<string, unknown>, document: EntityV2Document): void {
	keys(legacy, ["coordinateMode", "source"], [], "legacy")
	if (legacy.coordinateMode !== "armorstand-head-1.21.1" || !isObject(legacy.source)) throw invalid("unsupported legacy coordinate mode")
	if ("variants" in document.metadata || document.matrices.length || integer(document.metadata.matrixCount, "matrixCount") !== 0
		|| array(document.metadata.bones, "bones", MAX_BONES).length !== 0
		|| array(document.metadata.animations, "animations", MAX_ANIMATIONS).length !== 0)
		throw invalid("legacy mode must not contain native poses")
}

function validateAnimation(animation: Record<string, unknown>, names: Set<string>, boneOrder: string[], matrixCount: number, variants: string[], localTransforms: boolean): void {
	keys(animation, ["name", "length", "loopMode", "animType", "canPlayerMove", "effects", "tracks"], ["loopStartTime", "loopEndTime", "affectedBones", "channelMasks", "layer", "priority", "blendIn", "blendOut", "strideDistance", "locomotionMode", "restOnStop", "semanticDriver", "semanticPeriod"], "animation")
	const name = string(animation.name, "animation.name")
	const length = number(animation.length, "animation.length")
	const loopMode = string(animation.loopMode, "animation.loopMode")
	const hasStart = "loopStartTime" in animation, hasEnd = "loopEndTime" in animation
	if (length < 0 || hasStart !== hasEnd) throw invalid("invalid animation loop range")
	if (hasStart) {
		const start = number(animation.loopStartTime, "animation.loopStartTime"), end = number(animation.loopEndTime, "animation.loopEndTime")
		const boundary = (time: number) => Math.ceil(time * 20 - 1e-9)
		if (start < 0 || end < start || end > length || (loopMode === "loop" && (start >= end || boundary(start) >= boundary(end)))) throw invalid("invalid animation loop range")
	}
	const animType = string(animation.animType, "animation.animType")
	if (!LOOP_MODES.has(loopMode) || !ANIMATION_TYPES.has(animType)) throw invalid("unknown animation mode or type")
	const locomotion = new Set(["walk", "walk_angry", "sneak_walk", "fly"]).has(animType)
	const elapsed = animation.locomotionMode === 'elapsed'
	if ("locomotionMode" in animation && !elapsed) throw invalid("unknown locomotion mode")
	if (!elapsed && (locomotion !== ("strideDistance" in animation)
		|| locomotion && !(number(animation.strideDistance, "animation.strideDistance") > 0)))
		throw invalid("locomotion animations require a positive strideDistance")
	if (elapsed && (!locomotion || "strideDistance" in animation)) throw invalid("elapsed locomotion must not declare a stride distance")
	if ("restOnStop" in animation && (animation.restOnStop !== true || !elapsed)) throw invalid("restOnStop requires elapsed locomotion")
	if (typeof animation.canPlayerMove !== "boolean" || !isObject(animation.effects)) throw invalid("invalid animation fields")
	if ("layer" in animation && !/^[a-z0-9_-]{1,64}$/.test(string(animation.layer, "animation.layer"))) throw invalid("invalid animation layer")
	if ("semanticDriver" in animation && (!localTransforms || !SEMANTIC_DRIVERS.has(string(animation.semanticDriver, "animation.semanticDriver"))
		|| !("layer" in animation) || animation.layer === "base")) throw invalid("invalid semantic animation driver")
	if ("semanticPeriod" in animation && (animation.semanticDriver !== "age"
		|| !(number(animation.semanticPeriod, "animation.semanticPeriod") > 0)
		|| number(animation.semanticPeriod, "animation.semanticPeriod") > MAX_SEMANTIC_PERIOD)) throw invalid("invalid semantic animation period")
	if (animation.semanticDriver === "age" && loopMode === "loop" && !("semanticPeriod" in animation)) throw invalid("looped age animation requires a semantic period")
	if ("priority" in animation && (signedInteger(animation.priority, "animation.priority") < -1_000_000 || signedInteger(animation.priority, "animation.priority") > 1_000_000)) throw invalid("invalid animation priority")
	for (const field of ["blendIn", "blendOut"]) if (field in animation) {
		const seconds = number(animation[field], `animation.${field}`)
		if (seconds < 0 || seconds > 60) throw invalid(`invalid animation ${field}`)
		if (!localTransforms && seconds !== 0) throw invalid(`animation ${field} requires local transforms`)
	}
	const tracks = object(animation.tracks, "animation.tracks")
	if (!Object.keys(tracks).length) throw invalid("animation has no tracks")
	if (localTransforms) {
		if (("affectedBones" in animation) === ("channelMasks" in animation)) throw invalid("local animation requires exactly one influence mask")
		if ("affectedBones" in animation) {
			const affected = array(animation.affectedBones, "animation.affectedBones", names.size).map(value => string(value, "affected bone"))
			if (new Set(affected).size !== affected.length || affected.some((name, index) => !names.has(name) || !Object.prototype.hasOwnProperty.call(tracks, name) || (index > 0 && affected[index - 1] >= name))) throw invalid("invalid affected bones")
		} else {
			let previous = -1
			for (const value of array(animation.channelMasks, "animation.channelMasks", names.size)) {
				const pair = array(value, "animation channel mask", 2)
				if (pair.length !== 2) throw invalid("invalid animation channel mask")
				const bone = integer(pair[0], "animation channel bone"), mask = integer(pair[1], "animation channel bits")
				if (bone >= names.size || bone <= previous || mask < 1 || mask > 7 || !Object.prototype.hasOwnProperty.call(tracks, boneOrder[bone])) throw invalid("invalid animation channel mask")
				previous = bone
			}
		}
	} else if ("affectedBones" in animation || "channelMasks" in animation) throw invalid("world animation cannot declare influence masks")
	const frameCount = expectedFrames(length)
	validateEffects(object(animation.effects, "effects"), frameCount, variants, names)
	Object.entries(tracks).forEach(([bone, frames]) => {
		if (!names.has(bone)) throw invalid("track has unknown bone")
		const track = array(frames, "track frames", MAX_TRACK_FRAMES)
		if (track.length !== frameCount) throw invalid("track frame count mismatch")
		track.forEach(frame => index(frame, matrixCount, "track frame"))
	})
}

function validateEffects(effects: Record<string, unknown>, frameCount: number, variants: string[], names: Set<string>): void {
	keys(effects, ["sounds", "particles"], ["texture_variant", "visibility", "tint"], "effects")
	for (const name of ["sounds", "particles"]) {
		const channel = object(effects[name], `effects.${name}`)
		keys(channel, ["keyframes"], [], `effects.${name}`)
		const frames = array(channel.keyframes, `effects.${name}.keyframes`, frameCount)
		if (frames.length !== frameCount) throw invalid("effects frame count mismatch")
		frames.forEach(frame => array(frame, "effects frame", 1024))
	}
	if ("texture_variant" in effects) {
		const channel = object(effects.texture_variant, "effects.texture_variant"); keys(channel, ["keyframes"], [], "effects.texture_variant")
		const frames = array(channel.keyframes, "effects.texture_variant.keyframes", frameCount)
		if (frames.length !== frameCount) throw invalid("effects texture variant frame count mismatch")
		frames.forEach(value => { const name = boundedString(value, "texture variant", false); if (name !== "default" && !variants.includes(name)) throw invalid("unknown texture variant") })
	}
	if ("visibility" in effects) validatePropertyTracks(object(effects.visibility, "effects.visibility"), frameCount, names, "visibility")
	if ("tint" in effects) validatePropertyTracks(object(effects.tint, "effects.tint"), frameCount, names, "tint")
}

function validatePropertyTracks(channel: Record<string, unknown>, frameCount: number, names: Set<string>, kind: "visibility" | "tint"): void {
	keys(channel, ["tracks"], [], `effects.${kind}`)
	const tracks = object(channel.tracks, `effects.${kind}.tracks`)
	if (!Object.keys(tracks).length) throw invalid(`effects.${kind} has no tracks`)
	for (const [bone, values] of Object.entries(tracks)) {
		if (!names.has(bone)) throw invalid(`effects.${kind} has unknown bone`)
		const frames = array(values, `effects.${kind} track`, MAX_TRACK_FRAMES)
		if (frames.length !== frameCount) throw invalid(`effects.${kind} frame count mismatch`)
		for (const value of frames) {
			if (kind === "visibility") {
				if (value !== null && typeof value !== "boolean") throw invalid("invalid visibility value")
			} else if (typeof value !== "number" || !Number.isInteger(value) || value < -1 || value > 0xffffff) throw invalid("invalid tint value")
		}
	}
}

function expectedFrames(length: number): number { if (length > (MAX_TRACK_FRAMES - 1) / 20) throw invalid("animation length too large"); return Math.ceil(length * 20) + 1 }

export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
	if (typeof value === "number") return canonicalNumber(value)
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
	if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
	throw invalid("unsupported JSON value")
}

function canonicalNumber(value: number): string {
	if (!Number.isFinite(value)) throw invalid("non-finite JSON number")
	if (value === 0) return "0"
	const text = String(value)
	if (!/[eE]/.test(text)) return text
	const [coefficient, exponentText] = text.toLowerCase().split("e")
	const exponent = Number(exponentText)
	const negative = coefficient.startsWith("-")
	const digits = (negative ? coefficient.slice(1) : coefficient).replace(".", "")
	const decimal = coefficient.indexOf(".") < 0 ? coefficient.length : coefficient.indexOf(".")
	const position = decimal + exponent
	const plain = position <= 0 ? `0.${"0".repeat(-position)}${digits}` : position >= digits.length ? `${digits}${"0".repeat(position - digits.length)}` : `${digits.slice(0, position)}.${digits.slice(position)}`
	return negative ? `-${plain}` : plain
}

function keys(value: Record<string, unknown>, required: string[], optional: string[], what: string): void {
	const actual = Object.keys(value).sort(), expected = required.concat(optional.filter(key => key in value)).sort()
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw invalid(`unexpected ${what} fields`)
}
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
function object(value: unknown, what: string): Record<string, unknown> { if (!isObject(value)) throw invalid(`${what} must be an object`); return value }
function array(value: unknown, what: string, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw invalid(`${what} must be a bounded array`); return value }
function string(value: unknown, what: string): string { return boundedString(value, what, false) }
function boundedString(value: unknown, what: string, emptyAllowed: boolean): string { if (typeof value !== "string" || (!emptyAllowed && !value) || value.length > 256) throw invalid(`${what} must be a bounded string`); return value }
function number(value: unknown, what: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`${what} must be finite`); return value }
function integer(value: unknown, what: string): number { const result = number(value, what); if (!Number.isInteger(result) || result < 0 || result > 0x7fffffff) throw invalid(`${what} must be an integer`); return result }
function signedInteger(value: unknown, what: string): number { const result = number(value, what); if (!Number.isInteger(result)) throw invalid(`${what} must be an integer`); return result }
function index(value: unknown, count: number, what: string): void { if (integer(value, what) >= count) throw invalid(`${what} out of range`) }
function invalid(message: string): Error { return new Error(`Invalid IAE2: ${message}`) }
