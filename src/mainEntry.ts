import type * as aj from './iaentitymodel'

import * as fs from 'fs'

import { tl } from './util/intl'
import { registerLanguages } from './lang/register'
import { checkForUpdates } from './plugin/updateChecker'
import { registerLifecycleRedirects } from './lifecycle'
import { registerPluginDefinition } from './pluginDefinitions'

import './rotationSnap'
import './ui/panel/states'
import './ui/dialogs/settings'
import { ERROR } from './util/errors'
import { CustomError } from './util/customError'
import { format as modelFormat } from './modelFormat'
import { renderAnimation } from './animationRenderer'
import { settings } from './settings'
import {getAdvancedPlayerModelExportFolder, getModelExportFolder, needsToExportJsonsModels, isInternalModel} from "./util/utilz";
import { configurePlayerEmoteEditing, restoreHiddenUI } from './ui/mods/playerEmoteEditing'
import { registerInternalBoneProtection } from './ui/mods/internalBoneProtection'
import { registerMainMenu } from './ui/menu/mainMenu'
import { registerProjectUiHandlers } from './ui/mods/projectUiHandlers'
import { applyVariantPreview } from './ui/panel/states'
import { bus } from './util/bus'
import { createV2GeometryProfiles } from './exporters/v2GeometryProfiles'
import { beginV2EmbeddedTextures } from './format/v2EmbeddedTextures'

// import { makeArmorStandModel } from './makeArmorStandModel'

import {
	exportRigModels,
	exportTransparentTexture,
} from './exporting'

import {
	computeBones,
	computeElements,
	computeModels,
	computeScaleModels,
	computeVariantModels,
	computeVariantTextureOverrides,
} from './modelComputation'

registerLanguages()
registerLifecycleRedirects()
registerPluginDefinition()
checkForUpdates()
configurePlayerEmoteEditing(settings)
registerInternalBoneProtection()

export const BuildModel = (callback: any, options: any) => {
	if (!IAENTITY.exportInProgress) {
		IAENTITY.exportInProgress = true
		computeAnimationData(callback, options)
			.catch((e) => {
				if (e instanceof CustomError) {
					if (!e.options.intentional) {
						console.log('Custom Error:')
						throw e
					}
				} else {
					console.log('Unknown Error:')
					throw e
				}
			})
			.finally(() => {
				IAENTITY.exportInProgress = false
			})
	} else {
		Blockbench.showQuickMessage(tl('iaentitymodel.popups.exportInProgress'))
		ERROR.IAENTITY_BUSY()
	}
}

async function computeAnimationData(
	callback: (data: any) => any,
	options: any
) {
	console.groupCollapsed('Compute Animation Data')
	beginV2EmbeddedTextures(settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings))

	if(isInternalModel(settings)) {
		// Or getModelExportFolder won't work
		if (!Project) return
		if (!Project.save_path && Project.export_path) {
			Project.save_path = Project.export_path
		}
		if(!Project.save_path) {
			Blockbench.showQuickMessage(tl('iaentitymodel.popups.projectNotSaved'))
			return;
		}

		const modelExportFolder = getModelExportFolder(settings)
		const advancedModelExportFolder = needsToExportJsonsModels(settings)
			? getAdvancedPlayerModelExportFolder(settings)
			: modelExportFolder
		// Both files exists and it's not good!
		if(
			(needsToExportJsonsModels(settings) && fs.existsSync(`${modelExportFolder}/.player_animations`)) ||
			(!needsToExportJsonsModels(settings) && fs.existsSync(`${advancedModelExportFolder}/.player_advanced_animations`))
		) {
			// Delete all useless files.
			new Set([modelExportFolder, advancedModelExportFolder]).forEach(folder => {
				fs.readdirSync(folder).forEach(f => {
					// To be 100% sure we are not deleting files which the user might have put there because they are an idiot.
					if(f.endsWith(".json") || f.endsWith(".player_animations") || f.endsWith(".player_advanced_animations")) {
						fs.rmSync(`${folder}/${f}`)
					}
				});
			})
		}

		if (needsToExportJsonsModels(settings) && advancedModelExportFolder !== modelExportFolder) {
			const staleAdvancedAnimationFile = `${modelExportFolder}/.player_advanced_animations`
			if (fs.existsSync(staleAdvancedAnimationFile)) {
				fs.rmSync(staleAdvancedAnimationFile)
			}
		}
	}

	const animations = (await renderAnimation(options)) as aj.Animations
	applyVariantPreview('default')
	bus.dispatch('variant_preview_invalidated', {})
	const cubeData: aj.CubeData = computeElements()
	const models: aj.ModelObject = await computeModels(cubeData)
	const variantTextureOverrides = computeVariantTextureOverrides(
		models
	) as aj.VariantTextureOverrides
	const bones = computeBones(models, animations) as aj.BoneObject
	const scaleModels = computeScaleModels(bones)
	const variants = (await computeVariantModels(
		models,
		scaleModels,
		variantTextureOverrides
	)) as {
		variantModels: aj.VariantModels
		scaleModels: aj.ScaleModels
		variantTouchedModels: aj.variantTouchedModels
	}
	const geometryProfiles = settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings)
		? createV2GeometryProfiles(models, cubeData, variantTextureOverrides)
		: undefined

	if(needsToExportJsonsModels(settings) && !(settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings))) {
		await exportRigModels(models, variants.variantModels, scaleModels, geometryProfiles)
		if (settings.iaentitymodel.transparentTexturePath) {
			await exportTransparentTexture()
		}
	}

	const data = {
		settings: settings.toObject() as aj.GlobalSettings,
		cubeData,
		bones,
		models,
		scaleModels,
		variantTextureOverrides,
		variantModels: variants.variantModels,
		variantTouchedModels: variants.variantTouchedModels,
		geometryProfiles,
		animations,
	}
	console.groupEnd()
	console.groupCollapsed('Exporter Output')
	try {
		await callback(data)
	} finally {
		console.groupEnd()
	}
}

const menu = registerMainMenu()
global.LONEDEV_DEBUG_restoreHiddenUI = restoreHiddenUI
registerProjectUiHandlers(menu)


new Property(KeyframeDataPoint, 'string', 'name', {label: "Name", condition: point => Format.id === modelFormat.id && ['particle', 'sound'].includes(point.keyframe.channel), default: "minecraft:XXXXX"},);
new Property(KeyframeDataPoint, 'number', 'volume', {label: "Volume", condition: point => Format.id === modelFormat.id && 'sound' == point.keyframe.channel, default: 1},);
new Property(KeyframeDataPoint, 'number', 'pitch', {label: "Pitch", condition: point => Format.id === modelFormat.id && 'sound' == point.keyframe.channel, default: 1});

new Property(KeyframeDataPoint, 'string', 'locator_name', {label: "Bone (locator)", condition: point => Format.id === modelFormat.id && 'particle' == point.keyframe.channel, default: "locator_bone_name"} );
new Property(KeyframeDataPoint, 'number', 'speed', {label: "Speed", condition: point => Format.id === modelFormat.id && 'particle' == point.keyframe.channel, default: 1});
new Property(KeyframeDataPoint, 'number', 'count', {label: "Count", condition: point => Format.id === modelFormat.id && 'particle' == point.keyframe.channel, default: 1});
new Property(KeyframeDataPoint, 'number', 'x_delta', { label: 'X delta', condition: point => Format.id === modelFormat.id && 'particle' == point.keyframe.channel, default: 0 });
new Property(KeyframeDataPoint, 'number', 'y_delta', { label: 'Y delta', condition: point => Format.id === modelFormat.id && 'particle' == point.keyframe.channel, default: 0 });
new Property(KeyframeDataPoint, 'number', 'z_delta', { label: 'Z delta', condition: point => Format.id === modelFormat.id && 'particle' == point.keyframe.channel, default: 0 });

// Edit the Bedrock effect animator "script", "locator", "file" properties condition to hide itself if this project has our custom model format
KeyframeDataPoint["properties"].effect.condition = (point) => { return Format.id !== modelFormat.id && ['particle', 'sound'].includes(point.keyframe.channel) }
KeyframeDataPoint["properties"].script.condition = (point) => { return Format.id !== modelFormat.id && ['particle', 'timeline'].includes(point.keyframe.channel) }
KeyframeDataPoint["properties"].locator.condition = (point) => { return Format.id !== modelFormat.id && 'particle' == point.keyframe.channel }
KeyframeDataPoint["properties"].file.condition = (point) => { return Format.id !== modelFormat.id && ['particle', 'sound'].includes(point.keyframe.channel) }
