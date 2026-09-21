import { getAdvancedPlayerModelExportFolder, getModelExportFolder, isInternalModel, needsToExportJsonsModels } from '../util/utilz'

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
	const extension = getAnimationExportExtension(settings)
	const exportFolder = extension === '.player_advanced_animations'
		? getAdvancedPlayerModelExportFolder(settings)
		: getModelExportFolder(settings)
	Blockbench.writeFile(exportFolder + '/' + extension, {
		content: generated.animationFile,
		custom_writer: null,
	})
}
