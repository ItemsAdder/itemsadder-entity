import * as path from 'path'
import { getAdvancedPlayerModelExportFolder, getModelExportFolder, getProjectFolder, isInternalModel, needsToExportJsonsModels } from '../util/utilz'

export type GeneratedAnimationFile = {
	animationFile: string | Buffer
}

export function getAnimationExportExtension(settings: any) {
	if (!isInternalModel(settings)) return '.metadata'
	return needsToExportJsonsModels(settings)
		? '.player_advanced_animations'
		: '.player_animations'
}

export function writeAnimationFile(generated: GeneratedAnimationFile, settings: any) {
	if (!isInternalModel(settings) && settings.iaentitymodel.entityFormat === 'v2') {
		Blockbench.writeFile(path.join(getProjectFolder(), `${settings.iaentitymodel.projectName}.iaentity`), {
			content: generated.animationFile,
			custom_writer: null,
		})
		return
	}
	const extension = getAnimationExportExtension(settings)
	const exportFolder = extension === '.player_advanced_animations'
		? getAdvancedPlayerModelExportFolder(settings)
		: getModelExportFolder(settings)
	Blockbench.writeFile(exportFolder + '/' + extension, {
		content: generated.animationFile,
		custom_writer: null,
	})
}
