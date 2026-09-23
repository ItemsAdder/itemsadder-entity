import type * as aj from '../iaentitymodel'

import { tl } from '../util/intl'
import { store } from '../util/store'
import { settings } from '../settings'
import {getProjectFolder, isInternalModel} from '../util/utilz'
import { validateItemsAdderContentsFolder } from './itemsadderYaml'
import { createAnimationFile } from './animationFileBuilder'
import { createV2AnimationFile } from './v2AnimationExporter'
import { writeAnimationFile } from './animationFileWriter'
import { syncAnimationExportYaml } from './animationYamlSync'

async function exportAnimationFile(generated: { animationFile: string | Buffer; }) {
	console.log("settings", settings)
	writeAnimationFile(generated, settings)
}

async function animationExport(data: any) {
	let projectFolder = getProjectFolder()
	let projectNamespace = settings.iaentitymodel.namespace
	const contentsValidation = validateItemsAdderContentsFolder(projectFolder, projectNamespace)
	if (!contentsValidation.valid) {
		// @ts-ignore
		Blockbench.showMessageBox({
			title: "Export error",
			message: contentsValidation.message,
			icon: 'error'
		})
		if (contentsValidation.logMessage) console.log(contentsValidation.logMessage)
		return
	}

	const generated = settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings)
		? createV2AnimationFile(data)
		: await createAnimationFile(
		data.animations, // Animations (each entry is RenderedAnimation)
		data.bones,
		data.scaleModels,
		data.settings.iaentitymodel.rotationMode
	)

	const staticAnimationUuid = store.get('staticAnimationUuid')
	await exportAnimationFile(generated)
	syncAnimationExportYaml({
		projectFolder: getProjectFolder(),
		namespace: settings.iaentitymodel.namespace,
		projectName: settings.iaentitymodel.projectName,
		internalModel: isInternalModel(settings),
		animations: data.animations as aj.Animations,
		staticAnimationUuid,
		entityFormat: settings.iaentitymodel.entityFormat,
	})

	Blockbench.showQuickMessage(tl('iaentitymodel.popups.successfullyExported'))
}

export const registerVanillaAnimationExporter = (AJ: any) => {
	AJ.registerExportFunc('vanillaAnimationExporter', function () {
		AJ.build(
			(data: any) => {
				console.log('Input Data:', data)
				return animationExport(data)
			},
			{
				generate_static_animation: true,
			}
		)
	})
}
