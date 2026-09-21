import { Matrix4 } from 'three'
import { safeFunctionName } from '../util/replace'

function pack(matrix: Matrix4): number[] {
	const values = matrix.elements
	if (values[3] !== 0 || values[7] !== 0 || values[11] !== 0 || values[15] !== 1 || !values.every(Number.isFinite)) {
		throw new Error('Invalid local bone transform')
	}
	return [0, 1, 2, 4, 5, 6, 8, 9, 10].map(index => Math.fround(values[index]))
		.concat([12, 13, 14].map(index => Math.fround(values[index] / 16)))
}

export function nearestExportedParent(group: any, exported: ReadonlySet<any>): any | undefined {
	for (let parent = group?.parent; parent && typeof parent === 'object'; parent = parent.parent) {
		if (exported.has(parent)) return parent
	}
	return undefined
}

/** Complete exported ancestor chain, immediate parent first. */
export function exportedParentChain(group: any, exported: ReadonlySet<any>): any[] {
	const result = []
	for (let parent = nearestExportedParent(group, exported); parent; parent = nearestExportedParent(parent, exported)) result.push(parent)
	return result
}

/** Compose joint-local transforms through omitted groups without an inverse. */
export function localJointMatrix(group: any, exported: ReadonlySet<any>): number[] {
	const parent = nearestExportedParent(group, exported)
	const chain: Matrix4[] = []
	for (let current = group; current && current !== parent && typeof current === 'object'; current = current.parent) {
		if (!current.mesh?.matrix) throw new Error(`Missing local matrix for ${current.name || 'bone'}`)
		current.mesh.updateMatrix?.()
		chain.unshift(current.mesh.matrix)
	}
	const result = new Matrix4()
	for (const matrix of chain) result.multiply(matrix)
	return pack(result)
}

export const TRANSLATION_CHANNEL = 1
export const ROTATION_CHANNEL = 2
export const SCALE_CHANNEL = 4

function authoredMask(animation: any, group: any): number {
	const animator = animation?.animators?.[group?.uuid]
	if (!animator) return 0
	return (Array.isArray(animator.position) && animator.position.length ? TRANSLATION_CHANNEL : 0)
		| (Array.isArray(animator.rotation) && animator.rotation.length ? ROTATION_CHANNEL : 0)
		| (Array.isArray(animator.scale) && animator.scale.length ? SCALE_CHANNEL : 0)
}

/** Sparse [exported bone index, authored transform-channel bits], captured before baking. */
export function authoredChannelMasks(animation: any, groups: readonly any[]): number[][] {
	const exported = new Set(groups)
	const result: number[][] = []
	for (let index = 0; index < groups.length; index++) {
		const group = groups[index]
		const parent = nearestExportedParent(group, exported)
		let mask = 0
		for (let current = group; current && current !== parent && typeof current === 'object'; current = current.parent) {
			const authored = authoredMask(animation, current)
			// Omitted joints are folded into this joint's matrix, where pivot composition can couple channels.
			mask |= current === group || !authored ? authored : 7
		}
		if (mask) result.push([index, mask])
	}
	return result
}

/** Compatibility helper for callers which only need the former whole-bone mask. */
export function affectedBones(animation: any, groups: readonly any[]): string[] {
	return authoredChannelMasks(animation, groups).map(([index]) => safeFunctionName(groups[index].name)).sort()
}
