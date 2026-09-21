import assert from 'assert'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { displayMatrix } from './displayTransforms'
import { IDENTITY_AFFINE, profileSupportsRotation, staticLocalMatrix } from './v2GeometryProfiles'

function affine(values: readonly number[]): Matrix4 {
	return new Matrix4().fromArray([
		values[0], values[1], values[2], 0,
		values[3], values[4], values[5], 0,
		values[6], values[7], values[8], 0,
		values[9], values[10], values[11], 1,
	])
}

function close(actual: readonly number[], expected: readonly number[], epsilon = 2e-6) {
	assert.equal(actual.length, expected.length)
	actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= epsilon, `${index}: ${value} != ${expected[index]}`))
}

assert(profileSupportsRotation('compatible', [0, 22.5, 0]))
assert(!profileSupportsRotation('compatible', [0, 13, 0]))
assert(profileSupportsRotation('single_axis_45', [0, 13, 0]))
assert(!profileSupportsRotation('single_axis_45', [13, 7, 0]))
assert(profileSupportsRotation('unrestricted', [13, 91, -47]))
assert.throws(() => profileSupportsRotation('unrestricted', [NaN, 0, 0]))

const group = new Matrix4().compose(
	new Vector3(7, -3, 11),
	new Quaternion().setFromEuler(new Euler(0.3, -0.7, 0.2, 'ZYX')),
	new Vector3(1.2, 0.8, 1.5),
)
const local = new Matrix4().compose(
	new Vector3(4, 2, -5),
	new Quaternion().setFromEuler(new Euler(13 * Math.PI / 180, 27 * Math.PI / 180, -9 * Math.PI / 180, 'ZYX')),
	new Vector3(1, 1, 1),
)
const cube = group.clone().multiply(local)
for (const geometryScale of [1, 1.75, 4]) {
	const boneDisplay = affine(displayMatrix(group.elements, geometryScale))
	const cubeDisplay = affine(displayMatrix(cube.elements, geometryScale))
	const fragment = affine(staticLocalMatrix(local.elements, geometryScale))
	close(boneDisplay.multiply(fragment).elements, cubeDisplay.elements)
}

close(staticLocalMatrix(new Matrix4().elements, 2), IDENTITY_AFFINE, 0)

const singularGroup = new Matrix4().compose(new Vector3(3, 4, 5), new Quaternion(), new Vector3(0, 2, 1))
const singularCube = singularGroup.clone().multiply(local)
const singularFragment = affine(staticLocalMatrix(local.elements, 1.75))
close(affine(displayMatrix(singularGroup.elements, 1.75)).multiply(singularFragment).elements,
	affine(displayMatrix(singularCube.elements, 1.75)).elements)
