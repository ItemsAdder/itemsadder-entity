import type * as aj from '../iaentitymodel'

import { ensureCustomEntityYaml, syncEmoteYaml } from './itemsadderYaml'

type AnimationYamlSyncOptions = {
	projectFolder: string
	namespace: string
	projectName: string
	internalModel: boolean
	animations: aj.Animations
	staticAnimationUuid: string
	entityFormat: string
}

export function syncAnimationExportYaml(options: AnimationYamlSyncOptions) {
	if (options.internalModel) {
		syncEmoteYaml(
			options.projectFolder,
			options.namespace,
			options.projectName,
			options.animations,
			options.staticAnimationUuid
		)
		return
	}
	if (options.entityFormat === 'v2') return

	ensureCustomEntityYaml(
		options.projectFolder,
		options.namespace,
		options.projectName
	)
}
