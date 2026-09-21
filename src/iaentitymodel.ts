import events from './constants/events'
import { BuildModel } from './mainEntry'
import { store } from './util/store'
import { bus } from './util/bus'
import { registerActionPatches } from './bbmods/patchAction'
import { format as modelFormat } from './modelFormat'
import { tl } from './util/intl'
import { settings } from './settings'
import { registerSettingRenderer } from './ui/dialogs/settings'
import { registerBoneConfigMod } from './ui/mods/boneConfig'
import { registerAnimConfigMod } from './ui/mods/animConfig'
import { registerVanillaAnimationExporter } from './exporters/animationExporter'
import { registerModelFormatMod } from './bbmods/modelFormatMod'
import { registerFaceTintMod } from './bbmods/faceTint'
import { registerTextureVariantMod } from './ui/mods/textureVariant'
import { registerBoneEffectsMod } from './ui/mods/boneEffects'
// import './util/minecraft/items'
// import './util/minecraft/entities'
import { intl } from './util/intl'
import { CustomError } from './util/customError'

registerActionPatches()
registerBoneConfigMod()
registerAnimConfigMod()
registerModelFormatMod()
registerFaceTintMod()
registerTextureVariantMod()
registerBoneEffectsMod()

const errorMessages = [
	'Uh oh!',
	"Time to fire up the ol' debugger!",
	'Your armor stands are sad :(',
	'Ok, who pushed the big red button?',
]

function getRandomErrorMessage() {
	const index = Math.round(Math.random() * (errorMessages.length - 1))
	return errorMessages[index]
}

function showUnknownErrorDialog(e: CustomError | any) {
	if (e.options?.silent) {
		console.log(e.options.message)
		return
	}
	new Dialog(
		Object.assign(
			{
				id: 'iaentitymodel.dialogs.miscError',
				title: tl('iaentitymodel.dialogs.errors.misc.title'),
				lines: [
					tl(
						'iaentitymodel.dialogs.errors.misc.body',
						{
							buildID: process.env.BUILD_ID,
							errorMessage: e.options
								? e.options.message
								: e.message,
							randomErrorMessage: getRandomErrorMessage(),
							errorStack: e.stack,
							discordLink: process.env.DISCORD_LINK,
							githubLink: process.env.GITHUB_ISSUES_LINK,
						},
						true
					),
				],
				width: 1024,
				height: 512,
				singleButton: true,
			},
			e.options?.dialog || {}
		)
	).show()
}

const IAENTITY = {
	build(callback: Function, configuration: Record<any, any>) {
		const default_configuration = {
			generate_static_animation: false,
		}
		BuildModel(
			callback,
			Object.assign(default_configuration, configuration)
		)
	},
	registerExportFunc(name: string, exportFunc: () => void) {
		store.getStore('exporters').set(name, exportFunc)
	},
	settings,
	store: store,
	format: modelFormat,
	registerSettingRenderer,
	exportInProgress: false,
	get variants() {
		return store.get('states')
	},
	logging: false, //enable logging in production
	PromiseWrapper<T>(promise: Promise<T>): Promise<T> {
		return promise.catch((e) => {
			IAENTITY.asyncError(e)
			return e
		})
	},
	asyncError(e: Error) {
		showUnknownErrorDialog(e)
		IAENTITY.exportInProgress = false
		throw e
		// console.error('CUSTOM ERROR HANDLING', e)
	},
	logIntlDifferences(showDefaultValues: boolean) {
		intl.diff(showDefaultValues)
	},
}
delete window['IAENTITY']
// Object.defineProperty(window., 'IAENTITY', {
// 	value: IAENTITY,
// })
// @ts-ignore
window.IAENTITY = IAENTITY
registerVanillaAnimationExporter(IAENTITY)
bus.on(events.LIFECYCLE.CLEANUP, () => {
	console.log('CLEANUP')
	// @ts-ignore
	delete window.IAENTITY
})

// @ts-ignore
Blockbench.dispatchEvent('itemsadder-entity-ready', IAENTITY)
// @ts-ignore
if (Blockbench.events && Blockbench.events['itemsadder-entity-ready']) {
	// @ts-ignore
	Blockbench.events['itemsadder-entity-ready'].length = 0
}

// WOOO TYPING, YAAAAAAY

export interface SettingDescriptor {
	readonly value: any
	error?: string
	isValid?: boolean
	setting: any
	event: 'get' | 'set' | 'update' | 'dummy'
}

export interface Settings {
	projectName: string
	exporter: string
	useCache: boolean
	cacheMode: 'memory' | 'disk'
	itemsadder: string
	rotationMode: 'smooth' | 'precise'
	boundingBoxRenderMode: 'single' | 'multiple' | 'disabled'
	verbose: boolean
	modelScalingMode: '7x7x7' | '3x3x3'
	transparentTexturePath: string
	idleAnim: string
	walkAnim: string
	attackAnim: string
	deathAnim: string
	flyAnim: string
}

export interface GlobalSettings {
	iaentitymodel: Settings
	[index: string]: any
}

export type Bone = {
	nbt: string
	boneType: string
	maxHeadRotX: number
	maxHeadRotY: number
	export: boolean
} & Cube

export interface BoneObject {
	[index: string]: Bone
}

export type AnimationFrameBone = {
	export: boolean
	pos: { x: number; y: number; z: number }
	rot: { x: number; y: number; z: number }
	scale: { x: number; y: number; z: number }
}

export type Frame = {
	bones: AnimationFrameBone[]
	effects: any
}

export type RenderedAnimation = {
	frames: Frame[]
	maxDistance: number
	animType: string
	canPlayerMove: boolean
	name: string
	loopMode: 'loop' | 'hold' | 'once',
	length: number
}

export interface Animations {
	[index: string]: RenderedAnimation
}

export type ModelFace = {
	texture: `#${number}`
	uv: [number, number, number, number]
}

export type ModelElement = {
	faces: {
		north?: ModelFace
		south?: ModelFace
		east?: ModelFace
		west?: ModelFace
		up?: ModelFace
		down?: ModelFace
	}
	rotation: {
		angle: number
		axis: 'x' | 'y' | 'z'
		origin: [number, number, number]
	}
	to: [number, number, number]
	from: [number, number, number]
	uuid?: string
}

export type TextureObject = {
	[index: number]: string
	[index: `${number}`]: string
}

export type Model = {
	parent: string
	display: any
	elements: ModelElement[]
	textures: TextureObject
}

export interface ModelObject {
	[index: string]: Model
}

export interface CubeData {
	clear_elements: ModelElement[]
	element_index_lut: number[]
	invalid_rot_elements: Bone[]
	textures_used: Texture[]
}

type Vector3 = [number, number, number]

export type ModelDisplay = {
	head: {
		translation: Vector3,
		rotation: Vector3,
		scale: Vector3,
	},
}

export type ScaleModel = {
	aj: {
		customModelData: number
	}
	parent: string
	display: ModelDisplay
}

export interface ScaleModels {
	[index: string]: {
		[index: string]: ScaleModel
	}
}

export type VariantModel = {
	parent: string
	textures: TextureObject
}

export interface VariantModels {
	[index: string]: {
		[index: string]: VariantModel
	}
}

export interface VariantTextureOverrides {
	[index: string]: {
		[index: string]: {
			textures: TextureObject
		}
	}
}

export interface variantTouchedModels {
	[index: string]: Model
}
