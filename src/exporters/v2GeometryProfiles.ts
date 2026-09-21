import { Matrix4 } from 'three'
import { displayMatrix } from './displayTransforms'
import { safeFunctionName } from '../util/replace'

declare const Group: any

export const GEOMETRY_PROFILE_NAMES = ['compatible', 'single_axis_45', 'unrestricted'] as const
export type GeometryProfileName = typeof GEOMETRY_PROFILE_NAMES[number]

export type GeometryFragment = {
	staticLocalMatrix: number[]
	model: any
	variants: Record<string, { textures: Record<string, string> }>
}

export type V2GeometryProfiles = Record<GeometryProfileName, Record<string, GeometryFragment[]>>

export const IDENTITY_AFFINE = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

function packAffine(matrix: Matrix4): number[] {
	const values = matrix.elements
	if (values[3] !== 0 || values[7] !== 0 || values[11] !== 0 || Math.abs(values[15] - 1) > 1e-6) throw new Error('Invalid fragment transform')
	return [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14].map(index => Math.fround(values[index]))
}

/** Direct cube-local matrix applied after the animated bone display transform. */
export function staticLocalMatrix(cubeLocal: readonly number[], geometryScale: number): number[] {
	if (cubeLocal.length !== 16 || !cubeLocal.every(Number.isFinite) || !Number.isFinite(geometryScale) || geometryScale <= 0)
		throw new Error('Invalid fragment transform')
	const matrix = new Matrix4().fromArray(cubeLocal)
	matrix.elements[12] /= 16 * geometryScale
	matrix.elements[13] /= 16 * geometryScale
	matrix.elements[14] /= 16 * geometryScale
	return packAffine(matrix)
}

function nonZeroRotations(rotation: readonly number[]): number[] {
	if (rotation.length !== 3 || !rotation.every(Number.isFinite)) throw new Error('Invalid cube rotation')
	return rotation.filter(value => value !== 0)
}

export function profileSupportsRotation(profile: GeometryProfileName, rotation: readonly number[]): boolean {
	const nonZero = nonZeroRotations(rotation)
	if (profile === 'unrestricted') return true
	if (nonZero.length > 1) return false
	if (!nonZero.length) return true
	const angle = nonZero[0]
	return profile === 'single_axis_45'
		? angle >= -45 && angle <= 45
		: [-45, -22.5, 22.5, 45].includes(angle)
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value))
}

function normalizedPoint(point: readonly number[], geometryScale: number): number[] {
	return point.map(value => value / geometryScale + 8)
}

function nativeElement(source: any, cube: any, profile: GeometryProfileName, geometryScale: number): any {
	const element = clone(source)
	element.from = normalizedPoint(element.from, geometryScale)
	element.to = normalizedPoint(element.to, geometryScale)
	const rotation = Array.from(cube.rotation as number[])
	if (rotation.some(value => value !== 0) || cube.rescale) {
		const origin = normalizedPoint(cube.origin.map((value: number, index: number) => value - cube.parent.origin[index]), geometryScale)
		if (profile === 'unrestricted' && nonZeroRotations(rotation).length > 1) {
			element.rotation = { origin, x: rotation[0], y: rotation[1], z: rotation[2], ...(cube.rescale ? { rescale: true } : {}) }
		} else {
			const axisIndex = rotation.findIndex(value => value !== 0)
			const axis = ['x', 'y', 'z'][axisIndex < 0 ? 1 : axisIndex]
			element.rotation = { origin, axis, angle: axisIndex < 0 ? 0 : rotation[axisIndex], ...(cube.rescale ? { rescale: true } : {}) }
		}
	} else {
		delete element.rotation
	}
	delete element.uuid
	delete element.rotated
	return element
}

function splitElement(source: any, cube: any, geometryScale: number): any {
	const positions = cube.mesh?.geometry?.attributes?.position
	if (!positions?.array?.length) throw new Error(`Missing mesh geometry for cube ${cube.name}`)
	const min = [Infinity, Infinity, Infinity]
	const max = [-Infinity, -Infinity, -Infinity]
	for (let offset = 0; offset < positions.array.length; offset += 3) for (let axis = 0; axis < 3; axis++) {
		const value = positions.array[offset + axis]
		min[axis] = Math.min(min[axis], value)
		max[axis] = Math.max(max[axis], value)
	}
	const element = clone(source)
	element.from = normalizedPoint(min, geometryScale)
	element.to = normalizedPoint(max, geometryScale)
	delete element.rotation
	delete element.uuid
	delete element.rotated
	return element
}

function variantModels(elements: any[], variants: Record<string, any>): GeometryFragment['variants'] {
	const used = new Set<string>()
	for (const element of elements) for (const face of Object.values(element.faces || {}) as any[]) {
		if (typeof face.texture === 'string' && face.texture.startsWith('#')) used.add(face.texture.slice(1))
	}
	const result: GeometryFragment['variants'] = {}
	for (const [name, value] of Object.entries(variants || {}).sort(([a], [b]) => a.localeCompare(b))) {
		const textures: Record<string, string> = {}
		const overrides = value && (value as any).textures || {}
		for (const texture of Object.keys(overrides)) if (used.has(texture)) textures[texture] = overrides[texture]
		if (Object.keys(textures).length) result[name] = { textures }
	}
	return result
}

function model(textures: any, elements: any[]): any {
	return { textures: clone(textures || {}), elements, display: {} }
}

/** Build profile-specific models without passing V2 cubes through the legacy angle validator. */
export function createV2GeometryProfiles(models: Record<string, any>, cubeData: any, variantOverrides: Record<string, any>): V2GeometryProfiles {
	const profiles = Object.fromEntries(GEOMETRY_PROFILE_NAMES.map(name => [name, {}])) as V2GeometryProfiles
	const sourceByUuid = new Map((cubeData.clear_elements || []).map((element: any) => [element.uuid, element]))
	for (const group of Group.all) {
		const name = safeFunctionName(group.name)
		const baseModel = models[name]
		const hasModel = baseModel?.elements?.some((element: any) => element.from && element.to)
		const boneType = hasModel ? (group.boneType || 'normal') : (group.boneType && group.boneType !== 'normal' ? group.boneType : 'locator')
		if (boneType !== 'normal' && boneType !== 'head') continue
		if (!/^[a-z0-9._-]+$/.test(name) || name === '.' || name === '..') throw new Error(`Unsafe V2 geometry bone name: ${name}`)
		const geometryScale = baseModel?.v2GeometryScale ?? 1
		group.mesh.updateWorldMatrix(true, true)
		const cubes = group.children.filter((child: any) => child.type === 'cube' && child.visibility && sourceByUuid.has(child.uuid))
		for (const profileName of GEOMETRY_PROFILE_NAMES) {
			const identityElements: any[] = []
			const split = new Map<string, { matrix: number[]; elements: any[] }>()
			for (const cube of cubes) {
				const source = sourceByUuid.get(cube.uuid)
				if (profileSupportsRotation(profileName, cube.rotation)) {
					identityElements.push(nativeElement(source, cube, profileName, geometryScale))
					continue
				}
				cube.mesh.updateMatrix()
				const matrix = staticLocalMatrix(cube.mesh.matrix.elements, geometryScale)
				const key = matrix.join(',')
				if (!split.has(key)) split.set(key, { matrix, elements: [] })
				split.get(key)!.elements.push(splitElement(source, cube, geometryScale))
			}
			const fragments: GeometryFragment[] = []
			for (const entry of [{ matrix: IDENTITY_AFFINE, elements: identityElements }, ...Array.from(split.values())]) {
				const fragmentModel = model(baseModel?.textures, entry.elements)
				fragments.push({
					staticLocalMatrix: entry.matrix.slice(),
					model: fragmentModel,
					variants: variantModels(entry.elements, Object.fromEntries(Object.entries(variantOverrides || {}).map(([variant, bones]: [string, any]) => [variant, bones?.[name]]))),
				})
			}
			if (fragments.length > 256) throw new Error(`Too many ${profileName} geometry fragments for ${name}`)
			profiles[profileName][name] = fragments
		}
	}
	return profiles
}
