import assert from 'assert'
import { Matrix4, Object3D } from 'three'
import { displayMatrix } from './displayTransforms'
import { affectedBones, authoredChannelMasks, exportedParentChain, localJointMatrix, nearestExportedParent } from './v2LocalTransforms'

function group(name: string, parent: any, position: number[], rotation: number[], scale: number[]) {
	const mesh = new Object3D()
	mesh.position.fromArray(position)
	mesh.rotation.fromArray([...rotation, 'XYZ'] as any)
	mesh.scale.fromArray(scale)
	mesh.updateMatrix()
	return { name, uuid: `${name}-uuid`, parent, mesh }
}
function unpack(values: number[]): Matrix4 {
	return new Matrix4().fromArray([
		values[0], values[1], values[2], 0, values[3], values[4], values[5], 0,
		values[6], values[7], values[8], 0, values[9], values[10], values[11], 1,
	])
}
function close(actual: readonly number[], expected: readonly number[], epsilon = 2e-6) {
	assert.equal(actual.length, expected.length)
	actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= epsilon, `${index}: ${value} != ${expected[index]}`))
}

const root = group('root', 'root', [16, 3, -4], [0.2, -0.1, 0.3], [1.2, 0.8, 1.1])
const omitted = group('helper', root, [2, -7, 5], [-0.3, 0.25, 0.1], [0, 1.3, 0.9])
const tip = group('tip', omitted, [4, 6, -2], [0.1, 0.4, -0.2], [0.7, 1.1, 1.2])
const exported = new Set([root, tip])
assert.equal(nearestExportedParent(tip, exported), root)
assert.deepEqual(exportedParentChain(tip, exported), [root])

const middle = group('middle', root, [0, 0, 0], [0, 0, 0], [1, 1, 1])
const leaf = group('leaf', middle, [0, 0, 0], [0, 0, 0], [1, 1, 1])
assert.deepEqual(exportedParentChain(leaf, new Set([root, middle, leaf])), [middle, root])

const tipLocal = unpack(localJointMatrix(tip, exported))
const expectedLocal = omitted.mesh.matrix.clone().multiply(tip.mesh.matrix)
expectedLocal.elements[12] /= 16; expectedLocal.elements[13] /= 16; expectedLocal.elements[14] /= 16
close(tipLocal.elements, expectedLocal.elements)
assert.ok(tipLocal.elements.every(Number.isFinite), 'zero-scale ancestor must not require an inverse')

const worldPixels = root.mesh.matrix.clone().multiply(omitted.mesh.matrix).multiply(tip.mesh.matrix)
const localWorld = unpack(localJointMatrix(root, exported)).multiply(tipLocal)
const converted = new Matrix4().makeScale(-1, 1, -1).multiply(localWorld).multiply(new Matrix4().makeScale(1.75, 1.75, 1.75))
close(converted.elements.filter((_, index) => ![3, 7, 11, 15].includes(index)), displayMatrix(worldPixels.elements, 1.75))

const animation = { animators: {
	[root.uuid]: { position: [{ time: 0 }], rotation: [], scale: [] },
	[omitted.uuid]: { position: [], rotation: [{ time: 0 }], scale: [] },
	[tip.uuid]: { position: [], rotation: [], scale: [] },
} }
assert.deepEqual(affectedBones(animation, [tip, root]), ['root', 'tip'])
assert.deepEqual(authoredChannelMasks(animation, [tip, root]), [[0, 7], [1, 1]])
assert.deepEqual(affectedBones({ animators: {} }, [root, tip]), [])
assert.deepEqual(authoredChannelMasks({ animators: {} }, [root, tip]), [])
assert.deepEqual(authoredChannelMasks({ animators: {
	[root.uuid]: { position: [], rotation: [{ time: 0, value: [0, 0, 0] }], scale: [] },
} }, [root, tip]), [[0, 2]])
