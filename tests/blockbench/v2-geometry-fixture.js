'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', '..')
const fixturePath = path.join(root, 'test-fixtures/v2/blockbench/v2_geometry_fixture.iaentitymodel')
const textureSource = path.join(root, 'src/assets/mc-build.png')
const blinkTextureSource = path.join(root, 'src/assets/transparent.png')
const profiles = ['compatible', 'single_axis_45', 'unrestricted']

function decode(bytes) {
	const jsonBytes = bytes.readUInt32LE(8)
	const metadata = JSON.parse(bytes.subarray(16, 16 + jsonBytes).toString('utf8'))
	const matrices = []
	for (let offset = 16 + jsonBytes; offset < bytes.length; offset += 4) matrices.push(bytes.readFloatLE(offset))
	return { metadata, matrices }
}

function matrix(document, index) {
	const value = document.matrices.slice(index * 12, index * 12 + 12)
	return [value[0], value[1], value[2], 0, value[3], value[4], value[5], 0, value[6], value[7], value[8], 0, value[9], value[10], value[11], 1]
}

function multiply(a, b) {
	const out = Array(16).fill(0)
	for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k]
	return out
}

function displayBoneTransform(document, metadata, animation, boneName, frame) {
	const bones = new Map(metadata.bones.map(bone => [bone.name, bone]))
	const world = new Map()
	function resolve(name) {
		if (world.has(name)) return world.get(name)
		const bone = bones.get(name)
		const local = matrix(document, animation.tracks[name][frame])
		const value = bone.parents.length ? multiply(resolve(bone.parents[0]), local) : local
		world.set(name, value)
		return value
	}
	const bone = bones.get(boneName)
	const conversion = [-1,0,0,0, 0,1,0,0, 0,0,-1,0, 0,0,0,1]
	const scale = [bone.geometryScale,0,0,0, 0,bone.geometryScale,0,0, 0,0,bone.geometryScale,0, 0,0,0,1]
	return multiply(multiply(conversion, resolve(boneName)), scale)
}

function point(matrix, value) {
	return [0, 1, 2].map(row => matrix[row] * value[0] + matrix[4 + row] * value[1] + matrix[8 + row] * value[2] + matrix[12 + row])
}

function rotate(pointValue, rotation) {
	if (!rotation) return pointValue
	const origin = rotation.origin
	let [x, y, z] = pointValue.map((value, index) => value - origin[index])
	const values = 'angle' in rotation
		? { x: rotation.axis === 'x' ? rotation.angle : 0, y: rotation.axis === 'y' ? rotation.angle : 0, z: rotation.axis === 'z' ? rotation.angle : 0 }
		: rotation
	for (const axis of ['x', 'y', 'z']) {
		const angle = (values[axis] || 0) * Math.PI / 180
		const c = Math.cos(angle), s = Math.sin(angle)
		if (axis === 'x') [y, z] = [y * c - z * s, y * s + z * c]
		if (axis === 'y') [x, z] = [x * c + z * s, -x * s + z * c]
		if (axis === 'z') [x, y] = [x * c - y * s, x * s + y * c]
	}
	return [x + origin[0], y + origin[1], z + origin[2]]
}

function corners(from, to) {
	const result = []
	for (const x of [from[0], to[0]]) for (const y of [from[1], to[1]]) for (const z of [from[2], to[2]]) result.push([x, y, z])
	return result
}

function key(value) {
	return value.map(component => component.toFixed(5)).join(',')
}

function modelVertices(model, transform) {
	return new Set(model.elements.flatMap(element => corners(element.from, element.to).map(vertex => {
		const rotated = rotate(vertex, element.rotation).map(value => (value - 8) / 16)
		return key(point(transform, rotated))
	})))
}

function oracleVertices(cube) {
	const unique = new Set()
	for (let offset = 0; offset < cube.vertices.length; offset += 3) {
		const world = point(cube.matrixWorld, cube.vertices.slice(offset, offset + 3))
		unique.add(key([-world[0] / 16, world[1] / 16, -world[2] / 16]))
	}
	return unique
}

function listFiles(folder) {
	const result = []
	function visit(current) {
		for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const file = path.join(current, entry.name)
			if (entry.isDirectory()) visit(file)
			else result.push(file)
		}
	}
	visit(folder)
	return result
}

function snapshot(folder, metadataPath, packRoot) {
	const owner = crypto.createHash('sha256').update('test:entity/v2_geometry_fixture').digest('hex')
	const roots = [path.join(folder, 'profiles'),
		path.join(packRoot, `ia_overlay_v2_${owner}_1_21_6_plus/assets/test/models/entity/v2_geometry_fixture/profiles`),
		path.join(packRoot, `ia_overlay_v2_${owner}_modern_atlas/assets/test/models/entity/v2_geometry_fixture/profiles`)]
	const files = [metadataPath, path.join(packRoot, 'pack.mcmeta'), ...roots.flatMap(value => fs.existsSync(value) ? listFiles(value) : [])]
	return new Map(files.map(file => [file === metadataPath ? '.metadata' : path.relative(packRoot, file), fs.readFileSync(file)]))
}

async function waitFor(files) {
	const deadline = Date.now() + 15_000
	while (!files.every(file => fs.existsSync(file) && fs.statSync(file).size)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${files.join(', ')}`)
		await new Promise(resolve => setTimeout(resolve, 25))
	}
}

async function run(page, { oraclePath, projectPath }) {
	const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
	fixture.textures[0].path = textureSource; fixture.textures[0].saved = true
	fixture.textures[1].path = blinkTextureSource; fixture.textures[1].saved = true
	const projectRoot = path.dirname(projectPath)
	// Remove residue from an interrupted fixture run that loaded before resourcepack/assets existed.
	for (const legacyRoot of ['models', 'textures', 'resourcepack']) fs.rmSync(path.join(projectRoot, legacyRoot), { recursive: true, force: true })
	fs.mkdirSync(projectRoot, { recursive: true })
	fs.writeFileSync(projectPath, JSON.stringify(fixture, null, 2) + '\n')
	const resourceRoot = path.join(projectRoot, 'resourcepack/assets/test')
	const oracle = await page.evaluate(({ model, projectPath }) => {
		Codecs.iaentitymodel.load(model, { path: projectPath })
		const sample = (animationName, time) => {
			Modes.options.animate.select(); Canvas.updateAll()
			const animation = Animation.all.find(value => value.name === animationName)
			animation.select(); Timeline.time = time; Animator.preview()
			for (const group of Group.all) group.mesh.updateWorldMatrix(true, true)
			return Group.all.filter(group => ['root', 'tip'].includes(group.name)).map(group => ({
				bone: group.name,
				groupMatrixWorld: Array.from(group.mesh.matrixWorld.elements),
				cubes: group.children.filter(child => child.type === 'cube').map(cube => ({ name: cube.name, matrixWorld: Array.from(cube.mesh.matrixWorld.elements), vertices: Array.from(cube.mesh.geometry.attributes.position.array) })),
			}))
		}
		return { neutral: sample('neutral', 0), held: sample('held', 1) }
	}, { model: fixture, projectPath })
	fs.writeFileSync(oraclePath, JSON.stringify(oracle, null, 2) + '\n')

	const packRoot = path.dirname(path.dirname(resourceRoot))
	const modelRoot = path.join(resourceRoot, 'models/entity/v2_geometry_fixture')
	const owner = crypto.createHash('sha256').update('test:entity/v2_geometry_fixture').digest('hex')
	const overlayDirectory = profile => `ia_overlay_v2_${owner}_${profile === 'single_axis_45' ? '1_21_6_plus' : 'modern_atlas'}`
	const overlayRoot = profile => path.join(packRoot, overlayDirectory(profile), 'assets/test/models/entity/v2_geometry_fixture')
	const modelKey = (profile, bone, ordinal, variant) => path.relative(packRoot, path.join(profile === 'compatible' ? modelRoot : overlayRoot(profile), 'profiles', profile, ...(variant ? [variant] : []), bone, `${ordinal}.json`))
	const metadataPath = path.join(modelRoot, '.metadata')
	const required = [metadataPath,
		path.join(modelRoot, 'profiles/compatible/root/1.json'),
		path.join(overlayRoot('single_axis_45'), 'profiles/single_axis_45/root/0.json'),
		path.join(overlayRoot('unrestricted'), 'profiles/unrestricted/tip/0.json')]
	async function exportOnce() {
		fs.rmSync(metadataPath, { force: true }); fs.rmSync(path.join(modelRoot, 'profiles'), { recursive: true, force: true })
		fs.rmSync(path.join(overlayRoot('single_axis_45'), 'profiles'), { recursive: true, force: true })
		fs.rmSync(path.join(overlayRoot('unrestricted'), 'profiles'), { recursive: true, force: true })
		await page.evaluate(async () => {
			IAENTITY.store.getStore('exporters').get('vanillaAnimationExporter')()
			const deadline = Date.now() + 30_000
			while (IAENTITY.exportInProgress && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
			if (IAENTITY.exportInProgress) throw new Error('Timed out waiting for geometry export')
		})
		await waitFor(required)
		return snapshot(modelRoot, metadataPath, packRoot)
	}
	const first = await exportOnce()
	for (const legacyRoot of ['models', 'textures']) if (fs.existsSync(path.join(projectRoot, legacyRoot))) throw new Error(`Ambiguous top-level export layout: ${legacyRoot}`)
	for (const stale of [path.join(modelRoot, 'root.json'), path.join(modelRoot, 'tip.json'), path.join(modelRoot, 'blink/root.json'), path.join(modelRoot, 'blink/tip.json')]) {
		if (fs.existsSync(stale)) throw new Error(`Legacy V2 model survived profile export: ${stale}`)
	}
	const packMetadata = JSON.parse(first.get('pack.mcmeta'))
	for (const directory of [overlayDirectory('single_axis_45'), overlayDirectory('unrestricted')]) {
		if (!packMetadata.overlays?.entries?.some(value => value.directory === directory)) throw new Error(`Missing overlay declaration: ${directory}`)
	}
	const modernOverlay = packMetadata.overlays.entries.find(value => value.directory === overlayDirectory('unrestricted'))
	if (JSON.stringify(modernOverlay.formats) !== JSON.stringify([75, 9999]) || modernOverlay.min_format !== 75 || modernOverlay.max_format !== 9999) {
		throw new Error(`Invalid modern overlay format range: ${JSON.stringify(modernOverlay)}`)
	}
	const document = decode(first.get('.metadata'))
	const metadata = document.metadata
	if (metadata.transformSpace !== 'local') throw new Error('Geometry export did not use local transform space')
	if (JSON.stringify(Object.keys(metadata.geometryProfiles)) !== JSON.stringify(profiles)) throw new Error('Geometry profile names are not canonical')
	const expectedCounts = { compatible: { root: 2, tip: 2 }, single_axis_45: { root: 1, tip: 2 }, unrestricted: { root: 1, tip: 1 } }
	for (const profile of profiles) {
		if (JSON.stringify(Object.keys(metadata.geometryProfiles[profile]).sort()) !== JSON.stringify(['root', 'tip'])) throw new Error(`${profile} profile contains non-visual bones`)
		for (const bone of ['root', 'tip']) {
			const indices = metadata.geometryProfiles[profile][bone]
			if (indices.length !== expectedCounts[profile][bone]) throw new Error(`Wrong ${profile}/${bone} fragment count`)
			if (JSON.stringify(matrix(document, indices[0])) !== JSON.stringify([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])) throw new Error(`Non-identity primary fragment ${profile}/${bone}`)
		}
	}
	const single = JSON.parse(first.get(modelKey('single_axis_45', 'root', 0)))
	if (single.elements.length !== 2) throw new Error('Single-axis profile did not merge both compatible root cubes')
	const authored = single.elements.find(element => element.rotation?.angle === 13)
	if (authored?.rotation?.axis !== 'y' || authored.shade !== false || authored.faces.north.rotation !== 90) throw new Error('Single-axis profile lost authored cube properties')
	const compatiblePrimary = JSON.parse(first.get(modelKey('compatible', 'root', 0)))
	if (compatiblePrimary.elements.length !== 1) throw new Error('Compatible primary fragment did not retain the legal root cube')
	const unrestricted = JSON.parse(first.get(modelKey('unrestricted', 'tip', 0)))
	const unrestrictedRotation = unrestricted.elements[0].rotation
	if (unrestrictedRotation.x !== 13 || unrestrictedRotation.y !== 27 || unrestrictedRotation.z !== -9 || 'angle' in unrestrictedRotation || 'axis' in unrestrictedRotation) throw new Error('Unrestricted profile did not use XYZ rotation syntax')
	for (const profile of ['single_axis_45', 'unrestricted']) for (const bone of ['root', 'tip']) {
		for (let ordinal = 0; ordinal < expectedCounts[profile][bone]; ordinal++) {
			const placeholder = path.relative(packRoot, path.join(modelRoot, 'profiles', profile, bone, `${ordinal}.json`))
			if (JSON.stringify(JSON.parse(first.get(placeholder))) !== JSON.stringify({ elements: [] })) throw new Error(`Unsafe root placeholder: ${placeholder}`)
		}
	}
	for (const profile of profiles) for (const bone of ['root', 'tip']) {
		const indices = metadata.geometryProfiles[profile][bone]
		for (let ordinal = 0; ordinal < indices.length; ordinal++) {
			const variant = modelKey(profile, bone, ordinal, 'blink')
			const model = JSON.parse(first.get(modelKey(profile, bone, ordinal)))
			const hasElements = model.elements.length > 0
			if (first.has(variant) !== hasElements) throw new Error(`Variant sparsity mismatch: ${variant}`)
			if (first.has(variant) && JSON.parse(first.get(variant)).parent !== `test:entity/v2_geometry_fixture/profiles/${profile}/${bone}/${ordinal}`) throw new Error(`Bad variant parent: ${variant}`)
		}
	}
	const bones = new Map(metadata.bones.map(bone => [bone.name, bone]))
	for (const [animationName, samples] of Object.entries(oracle)) {
		const animation = metadata.animations.find(value => value.name === animationName)
		const frame = animationName === 'neutral' ? 0 : animation.tracks.root.length - 1
		for (const sample of samples) {
			const bone = bones.get(sample.bone)
			const boneTransform = displayBoneTransform(document, metadata, animation, sample.bone, frame)
			const expected = new Set(sample.cubes.flatMap(cube => [...oracleVertices(cube)]))
			for (const profile of profiles) {
				const actual = new Set()
				const indices = metadata.geometryProfiles[profile][sample.bone]
				for (let ordinal = 0; ordinal < indices.length; ordinal++) {
					const fragment = JSON.parse(first.get(modelKey(profile, sample.bone, ordinal)))
					for (const value of modelVertices(fragment, multiply(boneTransform, matrix(document, indices[ordinal])))) actual.add(value)
				}
				if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw new Error(`Vertex mismatch ${animationName}/${profile}/${sample.bone}: ${JSON.stringify([...actual])} != ${JSON.stringify([...expected])}`)
			}
		}
	}
	const second = await exportOnce()
	if (first.size !== second.size || [...first].some(([name, bytes]) => !second.get(name)?.equals(bytes))) throw new Error('Geometry export is nondeterministic')
	return { profiles: profiles.length, files: first.size, deterministic: true }
}

module.exports = { run }
