import * as path from 'path'
import * as fs from 'fs'
import crypto from 'crypto'
import type * as aj from '../iaentitymodel'
import { mkdir } from '../util/ezfs'
import { getCorrectInternalElementName, isInternalElement, toJson } from '../util/utilz'
import { DEFAULT_SCALE_MODEL_KEY } from '../constants/compat'
import { GEOMETRY_PROFILE_NAMES, V2GeometryProfiles } from './v2GeometryProfiles'

declare const Blockbench: any
declare function autoStringify(obj: any): string

function toExportJson(model: any) {
	return {
		...model,
		aj: undefined,
	}
}

export function hasExportableElements(model: any) {
	return !(!model.elements || model.elements.length == 0 || (model.elements.length == 1 && JSON.stringify(model.elements[0]) === '{}'))
}

export function writeBaseModel(modelExportFolder: string, name: string, model: any) {
	const modelFilePath = path.join(modelExportFolder, name + '.json')
	console.log('Exporting Model', modelFilePath, model.elements)
	Blockbench.writeFile(modelFilePath, {
		content: toJson(toExportJson(model)),
		custom_writer: null,
	})
}

export function writeScaleModel(
	modelExportFolder: string,
	models: aj.ModelObject,
	modelName: string,
	scale: string,
	model: any
) {
	if (scale === DEFAULT_SCALE_MODEL_KEY) return
	if (!isInternalElement(modelName) && scale === '0-0-0') return

	const baseModel = models[modelName]
	if (!hasExportableElements(baseModel)) return

	if (isInternalElement(modelName)) {
		model.parent = getCorrectInternalElementName(modelName)
		delete model.display.head
		model.display['thirdperson_righthand'] = {
			scale: [0, 0, 0],
		}
	}

	const modelFilePath = path.join(modelExportFolder, `${modelName}_${scale}.json`)
	console.log('Exporting Model', scale, modelFilePath)
	Blockbench.writeFile(modelFilePath, {
		content: autoStringify(toExportJson(model)),
		custom_writer: null,
	})
}

export function writeVariantModels(modelExportFolder: string, variantModels: aj.VariantModels) {
	for (const [variantName, variant] of Object.entries(variantModels)) {
		const variantFolderPath = path.join(modelExportFolder, variantName)
		if (Object.entries(variant).length < 1) continue

		mkdir(variantFolderPath, { recursive: true })

		for (const [modelName, model] of Object.entries(variant)) {
			const modelFilePath = path.join(variantFolderPath, `${modelName}.json`)
			console.log('Exporting Model', modelFilePath)
			Blockbench.writeFile(modelFilePath, {
				content: toJson(toExportJson(model)),
				custom_writer: null,
			})
		}
	}
}

function modelResourceLocation(modelExportFolder: string, modelFilePath: string): string {
	const relative = path.relative(path.dirname(path.dirname(modelExportFolder)), modelFilePath).replace(/\\/g, '/').replace(/\.json$/, '')
	return `${path.basename(path.dirname(path.dirname(path.dirname(modelExportFolder))))}:${relative}`
}

function overlayModelPath(modelExportFolder: string, modelFilePath: string, overlay: string): string {
	const normalized = modelExportFolder.replace(/\\/g, '/').split('/')
	const assets = normalized.lastIndexOf('assets')
	if (assets < 0 || normalized[assets + 2] !== 'models') throw new Error(`Invalid model export path: ${modelExportFolder}`)
	const root = normalized.slice(0, assets).join('/') || '/'
	return path.join(root, overlay, ...normalized.slice(assets), path.relative(modelExportFolder, modelFilePath))
}

export function geometryOverlayDirectories(modelExportFolder: string) {
	const normalized = modelExportFolder.replace(/\\/g, '/').split('/')
	const assets = normalized.lastIndexOf('assets')
	const namespace = normalized[assets + 1]
	const folder = path.basename(modelExportFolder)
	if (assets < 0 || !/^[a-z0-9._-]+$/.test(namespace) || namespace === '.' || namespace === '..'
		|| !/^[a-z0-9._-]+$/.test(folder) || folder === '.' || folder === '..') throw new Error(`Invalid model export path: ${modelExportFolder}`)
	const owner = crypto.createHash('sha256').update(`${namespace}:entity/${folder}`).digest('hex')
	return {
		single_axis_45: `ia_overlay_v2_${owner}_1_21_6_plus`,
		unrestricted: `ia_overlay_v2_${owner}_modern_atlas`,
	}
}

export function ensureGeometryOverlayMetadata(modelExportFolder: string) {
	const normalized = modelExportFolder.replace(/\\/g, '/').split('/')
	const assets = normalized.lastIndexOf('assets')
	if (assets < 0) throw new Error(`Invalid model export path: ${modelExportFolder}`)
	const packRoot = normalized.slice(0, assets).join('/') || '/'
	const metadataPath = path.join(packRoot, 'pack.mcmeta')
	let metadata: any = {}
	if (fs.existsSync(metadataPath)) {
		try { metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) } catch { throw new Error(`Invalid resource-pack metadata: ${metadataPath}`) }
	}
	if (!metadata.pack) metadata.pack = { pack_format: 32, description: 'ItemsAdder entity models' }
	if (!metadata.overlays) metadata.overlays = {}
	if (!Array.isArray(metadata.overlays.entries)) metadata.overlays.entries = []
	const directories = geometryOverlayDirectories(modelExportFolder)
	const required = [
		{ directory: directories.single_axis_45, formats: [63, 64], min_format: 63, max_format: 9999 },
		{ directory: directories.unrestricted, formats: [75, 9999], min_format: 75, max_format: 9999 },
	]
	const owned = new Set(required.map(value => value.directory))
	metadata.overlays.entries = metadata.overlays.entries.filter((value: any) => !owned.has(value?.directory)).concat(required)
	fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n')
}

export function writeGeometryProfileModels(modelExportFolder: string, profiles?: V2GeometryProfiles) {
	if (!profiles) return
	const folder = path.basename(modelExportFolder)
	if (!/^[a-z0-9._-]+$/.test(folder) || folder === '.' || folder === '..') throw new Error(`Unsafe V2 geometry folder name: ${folder}`)
	ensureGeometryOverlayMetadata(modelExportFolder)
	const overlayDirectories = geometryOverlayDirectories(modelExportFolder)
	for (const profileName of GEOMETRY_PROFILE_NAMES) for (const [bone, fragments] of Object.entries(profiles[profileName])) {
		if (!/^[a-z0-9._-]+$/.test(bone) || bone === '.' || bone === '..') throw new Error(`Unsafe V2 geometry bone name: ${bone}`)
		fragments.forEach((fragment, ordinal) => {
			const basePath = path.join(modelExportFolder, 'profiles', profileName, bone, `${ordinal}.json`)
			mkdir(path.dirname(basePath), { recursive: true })
			const overlay = profileName === 'single_axis_45' ? overlayDirectories.single_axis_45 : profileName === 'unrestricted' ? overlayDirectories.unrestricted : undefined
			const actualPath = overlay ? overlayModelPath(modelExportFolder, basePath, overlay) : basePath
			if (overlay) Blockbench.writeFile(basePath, { content: toJson({ elements: [] }), custom_writer: null })
			mkdir(path.dirname(actualPath), { recursive: true })
			Blockbench.writeFile(actualPath, { content: toJson(toExportJson(fragment.model)), custom_writer: null })
			for (const [variant, override] of Object.entries(fragment.variants)) {
				if (!/^[a-z0-9_-]{1,64}$/.test(variant) || variant === 'default') throw new Error(`Unsafe V2 geometry variant name: ${variant}`)
				const variantPath = path.join(modelExportFolder, 'profiles', profileName, variant, bone, `${ordinal}.json`)
				mkdir(path.dirname(variantPath), { recursive: true })
				const actualVariantPath = overlay ? overlayModelPath(modelExportFolder, variantPath, overlay) : variantPath
				const variantModel = {
					content: toJson({ parent: modelResourceLocation(modelExportFolder, basePath), textures: override.textures }),
					custom_writer: null,
				}
				if (overlay) Blockbench.writeFile(variantPath, { content: toJson({ elements: [] }), custom_writer: null })
				mkdir(path.dirname(actualVariantPath), { recursive: true })
				Blockbench.writeFile(actualVariantPath, variantModel)
			}
		})
	}
}
