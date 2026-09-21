import type * as aj from './iaentitymodel'

import { settings } from './settings'
// @ts-ignore
import transparent from './assets/transparent.png'
import { getAdvancedPlayerModelExportFolder, getModelExportFolder, isInternalElement, isInternalModel, needsToExportJsonsModels } from './util/utilz'
import { ensureRigFolderOwnership } from './exporters/rigFolder'
import { hasExportableElements, writeBaseModel, writeGeometryProfileModels, writeScaleModel, writeVariantModels } from './exporters/modelJsonWriter'
import type { V2GeometryProfiles } from './exporters/v2GeometryProfiles'
import * as fs from 'fs'
import * as path from 'path'

function hasCustomTextures(model: any) {
	return Object.keys(model?.textures || {}).length > 0
}

function shouldSkipBaseModel(name: string, model: any, exportInternalAdditions: boolean) {
	if (!isInternalElement(name)) return false
	return !exportInternalAdditions || !hasCustomTextures(model)
}

// Exports the model.json rig files
async function exportRigModels(
	models: aj.ModelObject,
	variantModels: aj.VariantModels,
	scaleModels: aj.ScaleModels,
	geometryProfiles?: V2GeometryProfiles
) {
	console.groupCollapsed('Export Rig Models')

	const exportInternalAdditions = needsToExportJsonsModels(settings)
	const modelExportFolder = isInternalModel(settings) && exportInternalAdditions
		? getAdvancedPlayerModelExportFolder(settings)
		: getModelExportFolder(settings)
	await ensureRigFolderOwnership(modelExportFolder)
	if (geometryProfiles) {
		for (const name of Object.keys(models)) {
			const file = path.join(modelExportFolder, `${name}.json`)
			if (fs.existsSync(file)) fs.unlinkSync(file)
		}
		for (const [variant, entries] of Object.entries(variantModels)) for (const name of Object.keys(entries)) {
			const file = path.join(modelExportFolder, variant, `${name}.json`)
			if (fs.existsSync(file)) fs.unlinkSync(file)
		}
		writeGeometryProfileModels(modelExportFolder, geometryProfiles)
		console.groupEnd()
		return
	}

	console.log('Export Models:', models)
	console.group('Details')

	for (const [name, model] of Object.entries(models)) {

		if(shouldSkipBaseModel(name, model, exportInternalAdditions)) {
			continue;
		}
		// Dirty shit to skip generating JSON models for internal bones.
		// Skip only if the bone wasn't resized, otherwise I have to include the bone (parent) in the export folder to make 
		// scaling working, or the scaled variants won't have the parent model.
		// NOTE: it's a bit shitty since each emotes pack will contain duplicate (parent) internal bone (but only if resized).
		// if(isInternalElement(name) && (!scaleModels[name] || Object.keys(scaleModels[name]).length <= 1)) {
		// 	continue;
		// }

		// Dirty shit to skip generating JSON models for empty bones (most likely utility bones)
		if(!hasExportableElements(model))
		{
			console.log(`Skipped export of empty bone: ${name}`);
			continue;
		}
		writeBaseModel(modelExportFolder, name, model)
	}
	console.groupEnd()

	console.log('Export Scale Models:', scaleModels)
	console.group('Details')
	for (const [modelName, scales] of Object.entries(scaleModels)) {
		// Export the models
		for (const [scale, model] of Object.entries(scales)) {
			writeScaleModel(modelExportFolder, models, modelName, scale, model)
		}
	}
	console.groupEnd()

	console.log('Export Variant Models:', variantModels)
	console.group('Details')

	writeVariantModels(modelExportFolder, variantModels)
	console.groupEnd()

	console.groupEnd()
}

async function exportTransparentTexture() {
	console.log(transparent)
	Blockbench.writeFile(settings.iaentitymodel.transparentTexturePath, {
		content: Buffer.from(
			String(transparent).replace('data:image/png;base64,', ''),
			'base64'
		),
		custom_writer: null,
	})
}

export { exportRigModels, exportTransparentTexture }
