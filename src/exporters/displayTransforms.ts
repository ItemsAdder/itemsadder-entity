/** Column-major affine matrices; Blockbench pixels become Minecraft blocks. */
export function displayMatrix(world: readonly number[], geometryScale = 1): number[] {
	if (world.length !== 16 || !world.every(Number.isFinite) ||
		!Number.isFinite(geometryScale) || geometryScale <= 0 ||
		world[3] !== 0 || world[7] !== 0 || world[11] !== 0 || world[15] !== 1) {
		throw new Error('Invalid affine bone transform')
	}
	const result: number[] = []
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 3; row++) {
			const unit = column === 3 ? 1 / 16 : geometryScale
			result.push(world[column * 4 + row] * unit * (row === 1 ? 1 : -1))
		}
	}
	return result
}

/** Bake a constant model-unit scale, leaving animated scale in the matrix. */
export function prepareDisplayModel(model: any): number {
	const elements = (model.elements || []).filter((element: any) => element.from && element.to)
	let largest = 24
	for (const element of elements) {
		for (const point of [element.from, element.to, element.rotation?.origin].filter(Boolean)) {
			if (point.length !== 3 || !point.every(Number.isFinite)) throw new Error('Invalid cube coordinates')
			for (const value of point) largest = Math.max(largest, Math.abs(value))
		}
	}
	const scale = largest / 24
	for (const element of elements) {
		element.from = element.from.map((value: number) => value / scale + 8)
		element.to = element.to.map((value: number) => value / scale + 8)
		if (element.rotation) element.rotation.origin = element.rotation.origin.map((value: number) => value / scale + 8)
	}
	model.display = {}
	// Export bookkeeping is not part of a vanilla model JSON.
	Object.defineProperty(model, 'v2GeometryScale', { value: scale, enumerable: false })
	return scale
}
