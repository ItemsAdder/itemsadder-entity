import { store } from './util/store'
import { size, removeNamespace } from './util/misc'
import { safeFunctionName } from './util/replace'
import { Path } from './util/path'
import * as pathjs from 'path'
import { getModelPath } from './util/minecraft/resourcepack'
// import { Items } from './util/minecraft/items'
import { tl } from './util/intl'
import {isPlayerModel, getModelExportFolder} from './util/utilz'
import {format} from "./modelFormat";
import { CustomError } from './util/customError'

function genericEmptyErrorText() {
	return tl('iaentitymodel.settings.generic.errors.emptyValue')
}
export let ForeignSettingTranslationKeys = {}
const UNASSIGNED = Symbol('UNASSIGNED_CACHE')
export const DefaultSettings = {
	iaentitymodel: {
		// playerAnimationsName: {
		// 	get title() {
		// 		return tl('iaentitymodel.settings.playerAnimationsName.title')
		// 	},
		// 	get description() {
		// 		return tl('iaentitymodel.settings.playerAnimationsName.description')
		// 	},
		// 	type: 'text',
		// 	default: '_undefined_default',
		// 	onUpdate(d) {
		// 		if (d.value !== '') {
		// 			if (d.value !== safeFunctionName(d.value)) {
		// 				d.isValid = false
		// 				d.error = tl(
		// 					'iaentitymodel.settings.playerAnimationsName.errors.invalidFunctionName'
		// 				)
		// 			}
		// 		} else {
		// 			d.isValid = false
		// 			d.error = genericEmptyErrorText()
		// 		}
		// 		return d
		// 	},
		// 	isVisible(s) {
		// 		return isInternalPlayerModel(settings);
		// 	},
		// 	dependencies: ['iaentitymodel.namespace'],
		// },
		namespace: {
			get title() {
				return tl('iaentitymodel.settings.namespace.title')
			},
			get description() {
				return tl('iaentitymodel.settings.namespace.description')
			},
			type: 'text',
			default: 'custom',
			onUpdate(d) {
				if (d.value !== '') {
					if (d.value !== safeFunctionName(d.value)) {
						d.isValid = false
						d.error = tl(
							'iaentitymodel.settings.namespace.errors.invalidFunctionName'
						)
					}
				} else {
					d.isValid = false
					d.error = genericEmptyErrorText()
				}
				return d
			},
			// isVisible(s) {
			// 	return !isInternalPlayerModel(settings);
			// },
			// dependencies: ['iaentitymodel.namespace'],
		},
		projectName: {
			get title() {
				return tl('iaentitymodel.settings.projectName.title')
			},
			get description() {
				return tl('iaentitymodel.settings.projectName.description')
			},
			type: 'text',
			default: 'project',
			onUpdate(d) {
				if (d.value !== '') {
					if (d.value !== safeFunctionName(d.value)) {
						d.isValid = false
						d.error = tl(
							'iaentitymodel.settings.projectName.errors.invalidFunctionName'
						)
					}
				} else {
					d.isValid = false
					d.error = genericEmptyErrorText()
				}
				return d
			},
			// isVisible(s) {
			// 	return !isInternalPlayerModel(settings);
			// },
			// dependencies: ['iaentitymodel.namespace'],
		},
		addsAdditionalModels: {
			get title() {
				return tl('iaentitymodel.settings.addsAdditionalModels.title')
			},
			get description() {
				return tl('iaentitymodel.settings.addsAdditionalModels.description')
			},
			type: 'checkbox',
			default: false,
			onUpdate(d) {
				d.setValue(d.value === true || d.value === 'true' || d.value === 1 || d.value === '1')
				return d
			},
			isVisible(s) {
			 	return isPlayerModel(settings);
			}
		},
		entityFormat: {
			title: 'Custom entity format',
			description: 'V2 uses item displays. Existing projects keep the legacy exporter until converted.',
			type: 'select',
			default: 'legacy',
			options: { legacy: 'Legacy (armor stands)', v2: 'V2 (item displays)' },
			isVisible() { return !isPlayerModel(settings) },
		},
		modelScalingMode: {
			get title() {
				return tl('iaentitymodel.settings.modelScalingMode.title')
			},
			get description() {
				return tl('iaentitymodel.settings.modelScalingMode.description')
			},
			type: 'select',
			default: '7x7x7',
			get options() {
				return {
					'7x7x7': tl(
						'iaentitymodel.settings.modelScalingMode.options.7x7x7'
					),
					'3x3x3': tl(
						'iaentitymodel.settings.modelScalingMode.options.3x3x3'
					)
				}
			},
			onUpdate(d) {
				if (!d.value) {
					d.isValid = false
					d.error = genericEmptyErrorText()
				}
				return d
			},
			// isVisible(s) {
			// 	return !isInternalPlayerModel(settings);
			// },
			// dependencies: ['iaentitymodel.namespace'],
		},
		rotationMode: {
			get title() {
				return tl('iaentitymodel.settings.rotationMode.title')
			},
			get description() {
				return tl(
					'iaentitymodel.settings.rotationMode.description'
				)
			},
			type: 'select',
			default: 'precise',
			options: {
				smooth: 'iaentitymodel.settings.rotationMode.options.smooth',
				precise: 'iaentitymodel.settings.rotationMode.options.precise',
			},
			// isVisible(s) {
			// 	return !isInternalPlayerModel(settings);
			// },
			// dependencies: ['iaentitymodel.namespace'],
		},
		useCache: {
			get title() {
				return tl('iaentitymodel.settings.useCache.title')
			},
			get description() {
				return tl('iaentitymodel.settings.useCache.description')
			},
			type: 'checkbox',
			default: true,
			onUpdate(d) {
				return d
			},
			global: true,
			// isVisible(s) {
			// 	return !isInternalPlayerModel(settings);
			// }
		},
		cacheMode: {
			get title() {
				return tl('iaentitymodel.settings.cacheMode.title')
			},
			get description() {
				return tl('iaentitymodel.settings.cacheMode.description')
			},
			type: 'select',
			default: 'memory',
			options: {
				memory: 'iaentitymodel.settings.cacheMode.options.memory',
				file: 'iaentitymodel.settings.cacheMode.options.disk',
			},
			onUpdate(d) {
				d.isValid = Boolean(this.options[d.value])
				return d
			},
			isVisible(s) {
				return s.iaentitymodel.useCache
					// && !isInternalPlayerModel(settings)
			},
			dependencies: ['iaentitymodel.useCache'],
			global: true,
		},
		/*boundingBoxRenderMode: {
			get title() {
				return tl('iaentitymodel.settings.boundingBoxRenderMode.title')
			},
			get description() {
				return tl(
					'iaentitymodel.settings.boundingBoxRenderMode.description'
				)
			},
			type: 'select',
			default: 'single',
			options: {
				single: 'iaentitymodel.settings.boundingBoxRenderMode.options.single',
				many: 'iaentitymodel.settings.boundingBoxRenderMode.options.many',
				none: 'iaentitymodel.settings.boundingBoxRenderMode.options.none',
			},
			global: true,
		},*/
		/*transparentTexturePath: {
			get title() {
				return tl('iaentitymodel.settings.transparentTexturePath.title')
			},
			get description() {
				return tl(
					'iaentitymodel.settings.transparentTexturePath.description'
				)
			},
			type: 'filepath',
			default: '',
			props: {
				target: 'file',
				dialogOpts: {
					defaultPath: '',
					promptToCreate: true,
					properties: ['openFile'],
				},
			},
			onUpdate(d) {
				if (d.value === '') {
					if(IAENTITY !== undefined && IAENTITY.variants !== undefined) {
						const variants = IAENTITY.variants
						if (
							variants &&
							Object.values(variants).find((v) =>
								Object.values(v).find((t) => t === 'transparent')
							)
						) {
							d.isValid = false
							d.error = tl(
								'iaentitymodel.settings.transparentTexturePath.errors.undefinedWhenNeeded'
							)
						}
					} else {
						d.isValid = false
						d.error = tl(
							'iaentitymodel.settings.transparentTexturePath.errors.undefinedWhenNeeded'
						)
					}
				}
				return d
			},
		},*/
	},
}
function createUpdateDescriptor(setting, value, event) {
	return {
		get value() {
			return value
		},
		set value(v) {
			throw new CustomError(
				'The value property on an UpdateDescriptor is not writable'
			)
		},
		setValue(v) {
			value = v
		},
		isValid: true,
		error: null,
		setting,
		event,
	}
}
function handleUpdateDescriptor(descriptor) {
	const { setting, isValid, value, error } = descriptor
	setting.isValid = isValid
	if (!isValid) {
		setting.error = error
	} else {
		setting.error = null
	}
	return value
}
function evaluateSetting(event, namespace, name, value) {
	const setting = DefaultSettings[namespace]?.[name]
	if (setting) {
		if (setting.onUpdate)
			return handleUpdateDescriptor(
				setting.onUpdate(createUpdateDescriptor(setting, value, event))
			)
		DefaultSettings[namespace][name].isValid = true
		DefaultSettings[namespace][name].error = null
		return value
	} else {
		throw new CustomError('Invalid setting path', `${namespace}.${name}`)
	}
}
class Settings {
	constructor() {
		this.storage = store.getStore('settings.project')
		this.globalStorage = store.getStore('settings.global')
		this.watchers = store.getStore('settings.watchers')
		if (this.storage.size === 0) {
			this.update(DefaultSettings, true, true)
			const keys = Object.keys(DefaultSettings)
			for (let i = 0; i < keys.length; i++) {
				const namespace = keys[i]
				this.assign(namespace, Object.keys(DefaultSettings[keys[i]]))
				for (const setting in DefaultSettings[keys[i]]) {
					if (DefaultSettings[keys[i]][setting].global) {
						this.watch(`${keys[i]}.${setting}`, () => {
							localStorage.setItem(
								process.env.GLOBAL_SETTINGS_KEY,
								JSON.stringify(
									Array.from(this.globalStorage.entries())
								)
							)
						})
					}
				}
			}
		}

		try {
			let global_data = JSON.parse(
				localStorage.getItem(process.env.GLOBAL_SETTINGS_KEY)
			) || []
			for (const [namespace, value] of global_data) {
				for (const key in value) {
					this.set(`${namespace}.${key}`, value[key])
				}
			}
			console.log('loaded global data', global_data)
		} catch (e) {
			console.warn('failed to load global data')
			console.error(e.message)
		}
	}
	getUpdateDescriptor(namespace, name, value) {
		const setting = DefaultSettings[namespace]?.[name]
		if (setting && typeof setting.onUpdate === 'function') {
			return setting.onUpdate(
				createUpdateDescriptor(setting, value, 'dummy')
			)
		}
		return createUpdateDescriptor(setting, value, 'dummy')
	}
	assign(namespace, settings) {
		delete this[namespace]
		const value = {}
		for (let i = 0; i < settings.length; i++) {
			Object.defineProperty(value, settings[i], {
				get: () => {
					return evaluateSetting(
						'get',
						namespace,
						settings[i],
						this.get(namespace + '.' + settings[i])
					)
				},
				set: (value) => {
					const validatedValue = evaluateSetting(
						'set',
						namespace,
						settings[i],
						value
					)
					if (!DefaultSettings[namespace][settings[i]].isValid) {
						throw new CustomError(
							`Invalid setting value for ${namespace}.${settings[i]}: ${value}`
						)
					}
					return this.set(
						namespace + '.' + settings[i],
						validatedValue
					)
				},
			})
		}
		this[namespace] = value
	}
	update(settings, use_default = false, global = false) {
		if (settings === DefaultSettings) use_default = true
		Object.keys(settings).forEach((namespace) => {
			if (typeof settings[namespace] === 'object') {
				let updated = false
				const val = this.storage.get(namespace) || {}
				const valGlobal = this.globalStorage.get(namespace) || {}
				Object.keys(settings[namespace]).forEach((name) => {
					if (
						DefaultSettings[namespace] &&
						DefaultSettings[namespace][name]
					) {
						try {
							if (
								global ||
								!DefaultSettings[namespace][name].global
							) {
								// target[name] = evaluateSetting(
								// 	namespace,
								// 	name,
								// 	settings[namespace][name]
								// )
								// this[namespace][name] = target[name]
								// if (use_default)
								// target[name] = target[name].default
								this.set(
									namespace + '.' + name,
									use_default
										? DefaultSettings[namespace][name]
												.default
										: evaluateSetting(
												'update',
												namespace,
												name,
												settings[namespace][name]
										  )
								)
								updated = true
								// }
							}
							updated = true
						} catch (e) {
							console.warn(
								'failed to evaluate setting, not setting',
								{
									namespace,
									name,
								},
								e
							)
						}
					} else {
						console.warn('unknown setting', {
							namespace,
							name,
						})
					}
				})
				// if (updated) {
				// 	if (size(val)) this.storage.set(namespace, val)
				// 	if (size(valGlobal))
				// 		this.globalStorage.set(namespace, valGlobal)
				// }
			} else {
				console.warn('unknown setting', {
					namespace,
				})
			}
		})
	}

	get(path) {
		const [major, minor] = path.split('.')
		let store = this.storage
		if (
			Reflect.has(DefaultSettings, major) &&
			Reflect.has(DefaultSettings[major], minor) &&
			DefaultSettings[major][minor].global
		)
			store = this.globalStorage
		return store.get(major)?.[minor]
	}

	set(path, value) {
		const [major, minor] = path.split('.')
		let store = this.storage
		if (
			Reflect.has(DefaultSettings, major) &&
			Reflect.has(DefaultSettings[major], minor) &&
			DefaultSettings[major][minor].global
		)
			store = this.globalStorage
		let host = store.get(major)
		if (!host) {
			host = {}
			store.set(major, host)
		}

		const res = (host[minor] = value)
		store.set(major, store.get(major))
		let toUpdate = this.watchers.get(path)
		if (toUpdate) {
			toUpdate.forEach((callback) => callback(value))
		}
		return res
	}

	registerPluginSettings(exporterId, exporterSettingsKey, settings) {
		DefaultSettings[exporterSettingsKey] = settings
		ForeignSettingTranslationKeys[
			exporterSettingsKey
		] = `${exporterId}.title`
		this.update(
			{
				[exporterSettingsKey]: settings,
			},
			true
		)
		this.assign(exporterSettingsKey, Object.keys(settings))
	}

	toConsumable(target = 'all') {
		const merged = new Map()
		function merge(entries) {
			const itterable = Array.from(entries)
			itterable.forEach(([key, value]) => {
				if (!merged.has(key)) merged.set(key, {})
				const data = merged.get(key)
				for (const key in value) {
					data[key] = value[key]
				}
			})
		}
		if (target === 'project' || target === 'all')
			merge(this.storage.entries())
		if (target === 'global' || target === 'all')
			merge(this.globalStorage.entries())
		const result = {}
		Array.from(merged.entries()).forEach(([key, value]) => {
			let _cached = null
			Object.defineProperty(result, key, {
				get() {
					if (_cached) return _cached
					_cached = {}
					Array.from(Object.entries(value)).forEach(
						([key2, value2]) => {
							let _cached2 = UNASSIGNED
							Object.defineProperty(_cached, key2, {
								get() {
									if (_cached2 != UNASSIGNED) return _cached2
									_cached2 = evaluateSetting(
										'get',
										key,
										key2,
										value2
									)
									return _cached2
								},
							})
						}
					)
					return _cached
				},
			})
		})
		return result
	}
	toObject(target = 'all') {
		const obj = {}
		const keys = Object.keys(DefaultSettings)
		for (let i = 0; i < keys.length; i++) {
			const namespace = keys[i]
			const sub = {}
			const subk = Object.keys(DefaultSettings[namespace])
			for (let j = 0; j < subk.length; j++) {
				const name = subk[j]
				if (
					!!DefaultSettings[namespace][name].global ===
						(target === 'global') ||
					target === 'all'
				)
					sub[name] = this.get(namespace + '.' + name)
			}
			if (size(sub)) obj[namespace] = sub
		}
		return obj
	}
	watch(name, cb) {
		const arr = this.watchers.get(name) || []
		arr.push(cb)
		this.watchers.set(name, arr)
		return () => arr.splice(arr.indexOf(cb), 1)
	}
}
export var settings = new Settings()
export const settingsByUUID = new Map()
export const updateSettingsOnProjectChange = () => {
	if (settingsByUUID.has(Project.uuid))
		settings.update(settingsByUUID.get(Project.uuid))
}
Blockbench.on('select_project', updateSettingsOnProjectChange)
