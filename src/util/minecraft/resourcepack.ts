//@ts-ignore
import * as path from 'path'
import * as fs from 'fs'
import { CustomError } from '../customError'
import { tl } from '../intl'
import { normalizePath } from '../misc'
import { getTexturesExportFolder } from '../utilz'
import { settings } from '../../settings'
import { addV2EmbeddedTexture } from '../../format/v2EmbeddedTextures'

function getResourceReferenceByPath(
	pathStr: string,
	namespaceSetting: string,
	folderName: 'models' | 'textures',
	name: string
) {
	const normalizedPath = normalizePath(pathStr)
	const parts = normalizedPath.split('/')
	const assetsIndex = parts.indexOf('assets')

	if (assetsIndex > -1) {
		const relative = parts.slice(assetsIndex + 1)
		const namespace = relative.shift()
		if (namespace && relative.length) {
			relative.push(relative.pop().replace(/\.png$|\.json$/, ''))
			const folderIndex = relative.indexOf(folderName)
			if (folderIndex > -1) {
				relative.splice(folderIndex, 1)
				return `${namespace}:${normalizePath(path.join(...relative))}`
			}
		}
	}

	const folderIndex = parts.indexOf(folderName)
	if (folderIndex > -1) {
		const relative = parts.slice(folderIndex + 1)
		if (relative.length) {
			relative.push(relative.pop().replace(/\.png$|\.json$/, ''))
			return `${namespaceSetting}:${normalizePath(path.join(...relative))}`
		}
	}

	console.log('Failed to generate path for:', pathStr)
	throw new CustomError(
		`Unable to generate ${folderName === 'textures' ? 'texture' : 'model'} path`,
		{
			dialog: {
				id:
					folderName === 'textures'
						? 'iaentitymodel.dialogs.errors.unableToGenerateTexturePath'
						: 'iaentitymodel.dialogs.errors.unableToGenerateModelPath',
				title: tl(
					folderName === 'textures'
						? 'iaentitymodel.dialogs.errors.unableToGenerateTexturePath.title'
						: 'iaentitymodel.dialogs.errors.unableToGenerateModelPath.title'
				),
				lines: [
					tl(
						folderName === 'textures'
							? 'iaentitymodel.dialogs.errors.unableToGenerateTexturePath.body'
							: 'iaentitymodel.dialogs.errors.unableToGenerateModelPath.body',
						folderName === 'textures'
							? { textureName: name }
							: { modelName: name }
					),
				],
				width: 512,
				singleButton: true,
			},
		}
	)
}

function getTextureReferenceByPath(pathStr: string, name: string) {
	const textureReference = getResourceReferenceByPath(
		pathStr,
		settings.iaentitymodel.namespace,
		'textures',
		name
	)
	console.log('Texture Reference:', textureReference)
	return textureReference
}

function getTextureReference(texture: TextureData) {
	return getTextureReferenceByPath(texture.path, texture.name)
}

export function getTexturePath(texture: any) {
	console.log('Saving texture:', texture)

	if (texture.namespace === 'minecraft') {
		return getTextureReference(texture)
	}
	if (settings.iaentitymodel.entityFormat === 'v2') {
		let bytes: Buffer | undefined
		const dataUrl = texture.getDataURL?.()
		if (texture.path && fs.existsSync(texture.path)) bytes = fs.readFileSync(texture.path)
		else if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
		if (!bytes) throw new Error(`Unable to read V2 texture: ${texture.name}`)
		const meta = texture.frameCount > 1 ? texture.getMCMetaContent?.() : undefined
		const embedded = addV2EmbeddedTexture(bytes, meta)
		if (embedded) {
			return `${settings.iaentitymodel.namespace}:ia_v2/${embedded.digest}`
		}
	}

	let texturesFolder = getTexturesExportFolder(settings)
	let newPath = path.join(texturesFolder, texture.name.toLowerCase())

	if (!newPath.endsWith('.png')) {
		newPath += '.png'
	}

	if (texture.path === '') {
		texture.path = newPath
	}

	if (texture.saved && fs.existsSync(texture.path)) {
		fs.copyFile(texture.path, newPath, (err) => {
			if (err) {
				console.error(err)
				return
			}
			console.log('Copied texture to export path', newPath)
		})
	} else {
		texture.saved = false
		const dataUrl = texture.getDataURL()
		if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
			const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
			fs.writeFileSync(newPath, base64Data, 'base64')
			texture.saved = true
			console.log('Created new texture file at', newPath)

			if (texture.frameCount && texture.frameCount > 1) {
				const metaContent = texture.getMCMetaContent()
				if (metaContent) {
					const metaPath = newPath.replace(/\.png$/, '.png.mcmeta')
					fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2))
					console.log('Created .mcmeta file at', metaPath)
				}
			}
		} else {
			console.error('Invalid data URL for texture:', dataUrl)
		}
	}

	return getTextureReferenceByPath(newPath, texture.name)
}

/***
 * Returns the Minecraft notation of a model path.
 * For example returns: `my_items:item/sword_1` from `project/assets/my_items/models/item/sword_1.json`
 */
export function getModelPath(modelPath: string, modelName: string) {
	console.log(modelPath)
	const modelReference = getResourceReferenceByPath(
		modelPath,
		settings.iaentitymodel.namespace,
		'models',
		modelName
	)
	console.log('Model Reference:', modelReference)
	return modelReference
}
