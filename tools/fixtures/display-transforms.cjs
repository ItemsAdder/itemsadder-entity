require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } })
const assert = require('node:assert/strict')
const { displayMatrix, prepareDisplayModel } = require('../../src/exporters/displayTransforms.ts')

function point(m, p) {
	return [0, 1, 2].map(r => m[r] * p[0] + m[4+r] * p[1] + m[8+r] * p[2] + m[12+r])
}
function expand(m) { return [m[0],m[1],m[2],0,m[3],m[4],m[5],0,m[6],m[7],m[8],0,m[9],m[10],m[11],1] }
function near(actual, expected) { actual.forEach((v, i) => assert.ok(Math.abs(v-expected[i]) < 1e-9, `${actual} != ${expected}`)) }

// A rotated child under a nonuniform parent can contain shear. Preserve the
// entire linear part, including off-diagonal entries, and a translated pivot.
const world = [0, 2, 0, 0, -3, 1.5, 0, 0, 0, 0, 0.01, 0, 32, -16, 48, 1]
for (const extent of [0.001, 8, 24, 25000]) {
	const original = [-extent, extent/2, extent/4]
	const model = { elements: [{ from: original.slice(), to: [extent,extent,extent], rotation: { origin: [5,1,-2] } }] }
	const k = prepareDisplayModel(model)
	const mc = model.elements[0].from.map(v => v/16-0.5)
	const observed = point(expand(displayMatrix(world, k)), mc)
	const expected = point(world, original).map((v,i) => v/16 * (i===1 ? 1 : -1))
	near(observed, expected)
	assert.ok(model.elements[0].to.every(v => v >= -16 && v <= 32))
	assert.ok(!JSON.stringify(model).includes('v2GeometryScale'))
}
for (const angle of [-180,-90,-89.999,0,89.999,90,180]) {
	const r = angle*Math.PI/180, c=Math.cos(r), s=Math.sin(r)
	const matrix = [c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1]
	near(point(expand(displayMatrix(matrix)), [1,0,0]), [-c,s,0])
}
assert.throws(() => displayMatrix([NaN]), /Invalid/)
assert.throws(() => prepareDisplayModel({elements:[{from:[0,Infinity,0],to:[0,0,0]}]}), /Invalid/)
console.log('PASS display transforms: shear, translated pivots, small/large geometry, ±90/180°, invalid data')
