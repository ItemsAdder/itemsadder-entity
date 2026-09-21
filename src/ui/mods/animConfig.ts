import { tl} from '../../util/intl'
import { isCustomFormat, format as modelFormat } from '../../modelFormat'
import {isInternalModel} from "../../util/utilz";
import { settings } from '../../settings'
import { CustomError } from '../../util/customError'
import { isLoopMarker, LOOP_MARKER_COLOR, LOOP_MARKER_NAME } from '../../constants/loopMarkers'
import events from '../../constants/events'
import { bus } from '../../util/bus'
import { animationLayerSettings, isLocomotionAnimation, locomotionStrideSettings, semanticDriverSettings } from '../../animationSettings'

let registered = false

export function registerAnimConfigMod() {
	if (registered) return
	registered = true

// Properties registration to make Blockbench save them in the project file
const animTypeProperty = new Property(Animation, 'string', 'animType', {
	default: () => undefined,
	exposed: true,
	condition: (val: any) => val !== undefined && val !== ""
})
const canPlayerMoveProperty = new Property(Animation, 'string', 'canPlayerMove', {
	default: () => undefined,
	exposed: true,
	condition: (val: any) => val !== undefined && val !== ""
})
const layerProperty = new Property(Animation, 'string', 'layer', {
	default: () => undefined,
	exposed: true,
	condition: (val: any) => val !== undefined && val !== '' && val !== 'base'
})
const priorityProperty = new Property(Animation, 'number', 'priority', {
	default: () => undefined,
	exposed: true,
	condition: (val: any) => val !== undefined && val !== 0
})
const blendInProperty = new Property(Animation, 'number', 'blendIn', {
	default: () => undefined,
	exposed: true,
	condition: (val: any) => val !== undefined && val !== 0
})
const blendOutProperty = new Property(Animation, 'number', 'blendOut', {
	default: () => undefined,
	exposed: true,
	condition: (val: any) => val !== undefined && val !== 0
})
const strideDistanceProperty = new Property(Animation, 'number', 'strideDistance', {
	default: () => undefined,
	exposed: true,
	condition: (val: any) => val !== undefined
})
const locomotionModeProperty = new Property(Animation, 'string', 'locomotionMode', {
	default: () => undefined, exposed: true, condition: (val: any) => val !== undefined
})
const restOnStopProperty = new Property(Animation, 'string', 'restOnStop', {
	default: () => undefined, exposed: true, condition: (val: any) => val !== undefined
})
const semanticDriverProperty = new Property(Animation, 'string', 'semanticDriver', {
	default: () => undefined,
	exposed: true,
	condition: (val: any) => val !== undefined && val !== '' && val !== 'none'
})
const semanticPeriodProperty = new Property(Animation, 'number', 'semanticPeriod', {
	default: () => undefined,
	exposed: true,
	condition: (val: any) => val !== undefined
})

const refreshAnimIcons = () => {
	// @ts-ignore
	Animation.all.forEach(anim => {
		let icon = ""
		if(anim.animType === "idle")
			icon = `<i class="material-icons">person</i>`
		else if(anim.animType === "walk")
			icon = `<i class="material-icons">directions_run</i>`
		else if(anim.animType === "attack")
			icon = `<i class="fa fa-fist-raised"></i>`
		else if(anim.animType === "death")
			icon = `<i class="fa fa-skull-crossbones"></i>`
		else if(anim.animType === "fly")
			icon = `<i class="fa fa-dove"></i>`

		document.querySelector(`[anim_type_anim_id='${anim.uuid}']`)?.remove()
		document.querySelector(`[anim_id='${anim.uuid}']`).insertAdjacentHTML("beforeend", `<div anim_type_anim_id='${anim.uuid}' class="in_list_button unclickable">${icon}</div>`)
	})
}

const handleClick_animType = (animation, name) => {

	// Make sure only one animation has this type set
	if(name != "other") {
		// @ts-ignore
		Animation.all.forEach(anim => {
			if(anim.animType == name) {
				anim.animType = "other"
			}
		})
	}

	if(animation.animType != name)
		Project.saved = false

	animation.animType = name

	refreshAnimIcons()
}

const handleClick_canPlayerMove = (animation, val) => {

	if(animation.canPlayerMove != val) {
		Project.saved = false
		animation.canPlayerMove = val
	}
}

let isInternalModel_ = () => isInternalModel(settings)
const isExternalV2 = () => isCustomFormat() && settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings)

const animationTypeTitle = tl('iaentitymodel.menu.animation.animType.title')
const canPlayerMoveTitle = tl('Can Player Move')
const layerSettingsTitle = 'V2 Animation Settings…'
// @ts-ignore Remove entries left behind by versions that did not clean up on unload.
const animationMenu = Animation.prototype.menu.structure
for (let index = animationMenu.length - 1; index >= 0; index--) {
	if (animationMenu[index]?.name !== animationTypeTitle) 
		continue
	const start = animationMenu[index - 1] === '_' ? index - 1 : index
	let end = animationMenu[index + 1]?.name === canPlayerMoveTitle ? index + 1 : index
	if (animationMenu[end + 1]?.name === layerSettingsTitle) end++
	if (animationMenu[end + 1] === '_') 
		end++
	animationMenu.splice(start, end - start + 1)
}

const animationTypeMenu = {name: animationTypeTitle, icon: 'movie', children: [
	{name: tl('iaentitymodel.menu.animation.animType.value.other'), icon: animation => (animation.animType == 'other' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) { handleClick_animType(animation, "other") }, condition: isCustomFormat},
	{name: tl('iaentitymodel.menu.animation.animType.value.idle'), icon: animation => (animation.animType == 'idle' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) { handleClick_animType(animation, "idle") }, condition: isCustomFormat},
	{name: tl('iaentitymodel.menu.animation.animType.value.walk'), icon: animation => (animation.animType == 'walk' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) { handleClick_animType(animation, "walk") }, condition: isCustomFormat},
	{name: tl('iaentitymodel.menu.animation.animType.value.attack'), icon: animation => (animation.animType == 'attack' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) { handleClick_animType(animation, "attack") }, condition: isCustomFormat},
	{name: tl('iaentitymodel.menu.animation.animType.value.death'), icon: animation => (animation.animType == 'death' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) { handleClick_animType(animation, "death") }, condition: isCustomFormat},
	{name: tl('iaentitymodel.menu.animation.animType.value.fly'), icon: animation => (animation.animType == 'fly' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) { handleClick_animType(animation, "fly") }, condition: isCustomFormat},
]}
const canPlayerMoveMenu = {name: canPlayerMoveTitle, icon: 'movie', children: [
	{name: tl("True"), icon: animation => (animation.canPlayerMove == 'true' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) { handleClick_canPlayerMove(animation, "true") }, condition: isInternalModel_},
	{name: tl("False"), icon: animation => (animation.canPlayerMove == 'false' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) { handleClick_canPlayerMove(animation, "false") }, condition: isInternalModel_},
]}
const layerSettingsMenu = {
	name: layerSettingsTitle,
	icon: 'layers',
	condition: isExternalV2,
	click(animation: any) {
		new Dialog({
			id: 'iaentitymodel_v2_layer_settings',
			title: layerSettingsTitle,
			form: {
				layer: { label: 'Layer', type: 'text', value: animation.layer || 'base' },
				priority: { label: 'Priority', type: 'number', value: animation.priority ?? 0, min: -1000000, max: 1000000, step: 1 },
				blendIn: { label: 'Blend In (seconds)', type: 'number', value: animation.blendIn ?? 0, min: 0, max: 60, step: 0.05 },
				blendOut: { label: 'Blend Out (seconds)', type: 'number', value: animation.blendOut ?? 0, min: 0, max: 60, step: 0.05 },
				strideDistance: { label: 'Stride distance (blocks per cycle)', type: 'number', value: animation.strideDistance ?? 0, min: 0, step: 0.01 },
				semanticDriver: { label: 'Semantic driver', type: 'select', value: animation.semanticDriver || 'none', options: {
					none: 'None', age: 'Entity age', aggressive: 'Aggressive state', attack_progress: 'Attack progress',
				} },
				semanticPeriod: { label: 'Semantic period (age ticks)', type: 'number', value: animation.semanticPeriod ?? 0, min: 0, max: 1000000, step: 0.001 },
			},
			onConfirm(result: any) {
				let values
				const semanticPeriod = result.semanticDriver === 'age' ? Number(result.semanticPeriod) || undefined : undefined
				try {
					values = animationLayerSettings({ layer: String(result.layer || 'base'), priority: Number(result.priority), blendIn: Number(result.blendIn), blendOut: Number(result.blendOut) })
					if (isLocomotionAnimation(animation)) locomotionStrideSettings({ ...animation, strideDistance: Number(result.strideDistance) })
					semanticDriverSettings({ ...animation, layer: values.layer, semanticDriver: result.semanticDriver, semanticPeriod })
				} catch (error: any) {
					Blockbench.showQuickMessage(error.message, 4000)
					return
				}
				Undo.initEdit({ animations: [animation] })
				animation.layer = values.layer === 'base' ? undefined : values.layer
				animation.priority = values.priority || undefined
				animation.blendIn = values.blendIn || undefined
				animation.blendOut = values.blendOut || undefined
				animation.strideDistance = isLocomotionAnimation(animation) ? Number(result.strideDistance) : undefined
				animation.semanticDriver = result.semanticDriver === 'none' ? undefined : result.semanticDriver
				animation.semanticPeriod = semanticPeriod
				Project.saved = false
				Undo.finishEdit('Edit V2 layer settings')
				this.hide()
			}
		}).show()
	}
}
const animationMenuEntries = [new MenuSeparator(), animationTypeMenu, canPlayerMoveMenu, layerSettingsMenu, new MenuSeparator()]
animationMenu.splice(12, 0, ...animationMenuEntries)


const previousLoopMarkerColor = markerColors[-1]
markerColors[-1] = {pastel: '#ffffff', standard: '#ffffff', name: 'loop_start_end'}


function getLoopMarkers(animation) {
	return animation?.markers?.filter(isLoopMarker) || []
}

function removeLoopMarkers(animation) {
	for (let index = animation.markers.length - 1; index >= 0; index--) {
		if (isLoopMarker(animation.markers[index])) {
			animation.markers.splice(index, 1)
		}
	}
}

function getLoopStartEndMarkers(animation) {
	const markers = getLoopMarkers(animation)
		.sort((a, b) => a.time - b.time)

	if (!markers || markers.length < 2 || markers[0].time === markers[1].time) return null
	return [markers[0], markers[1]]
}

function redrawTimeline() {
	const timeline = Timeline as any
	timeline.vue?._data?.animation_length && (timeline.vue._data.animation_length = timeline.vue._data.animation_length)
	timeline.vue?.$forceUpdate?.()
}

function toggleLoopMarkers() {
	// @ts-ignore
	const animation = Animation.selected
	if (!animation) return

	if (animation.loop !== 'loop') {
		// @ts-ignore
		Blockbench.showMessageBox({
			message: tl('iaentitymodel.exporters.vanillaAnimation.dialogs.errors.markerNoLoopAnim.message'),
			icon: 'error',
		})
		return
	}

	const loopMarkers = getLoopMarkers(animation)
	if (loopMarkers.length >= 2) {
		removeLoopMarkers(animation)
	} else {
		const startTime = Math.max(0, (Timeline as any).snapTime(Timeline.time))
		const TimelineMarkerClass = (globalThis as any).TimelineMarker
		animation.markers.push(new TimelineMarkerClass({time: startTime, color: LOOP_MARKER_COLOR, name: LOOP_MARKER_NAME}))
	}
	Project.saved = false
	redrawTimeline()
}

let activePlaybackLoopMarkers = null
const originalTimelineStart = Timeline.start
const patchedTimelineStart = function () {
	const animation = (Animation as any).selected
	const loopMarkers = isCustomFormat() && animation?.loop === 'loop'
		? getLoopStartEndMarkers(animation)
		: null
	activePlaybackLoopMarkers = loopMarkers && Timeline.time >= loopMarkers[0].time && Timeline.time <= loopMarkers[1].time
		? loopMarkers
		: null
	return originalTimelineStart.apply(this, arguments)
}
Timeline.start = patchedTimelineStart

const originalTimelineLoop = Timeline.loop
const patchedTimelineLoop = function () {
	const loopMarkers = activePlaybackLoopMarkers

	if (!loopMarkers) {
		return originalTimelineLoop.apply(this, arguments)
	}

	const timeline = Timeline as any
	const previousRange = [...timeline.custom_range]
	timeline.custom_range = [loopMarkers[0].time, loopMarkers[1].time]
	try {
		return originalTimelineLoop.apply(this, arguments)
	} finally {
		timeline.custom_range = previousRange
	}
}
Timeline.loop = patchedTimelineLoop

BarItems['add_loop_marker']?.delete()
const addLoopMarkerAction = new Action('add_loop_marker', {
	name: tl("iaentitymodel.exporters.vanillaAnimation.other.toggleLoopMarkers"),
	icon: 'update',
	category: 'animation',
	condition: () => {
		return isCustomFormat() && (globalThis as any).Mode.selected?.name === 'Animate' && (Animation as any).selected?.loop === 'loop'
	},
	click: toggleLoopMarkers
})
// @ts-ignore
addLoopMarkerAction.pushToolbar(Toolbars.timeline, 1)

const handleSelectProject = () => {
	queueMicrotask(() => {
		if(Format.id === modelFormat.id) {
			// Refresh animation icons
			refreshAnimIcons()
		}
	})
}
// @ts-ignore
Blockbench.on('select_project', handleSelectProject)

bus.on(events.LIFECYCLE.CLEANUP, () => {
	registered = false
	animationMenuEntries.forEach((entry) => {
		const index = animationMenu.indexOf(entry)
		if (index !== -1) animationMenu.splice(index, 1)
	})
	if (Timeline.start === patchedTimelineStart) 
		Timeline.start = originalTimelineStart
	if (Timeline.loop === patchedTimelineLoop) 
		Timeline.loop = originalTimelineLoop
	addLoopMarkerAction.delete()
	// @ts-ignore Blockbench 5 API missing from the bundled Blockbench 4 typings
	Blockbench.removeListener('select_project', handleSelectProject)
	animTypeProperty.delete()
	canPlayerMoveProperty.delete()
	layerProperty.delete()
	priorityProperty.delete()
	blendInProperty.delete()
	blendOutProperty.delete()
	strideDistanceProperty.delete()
	locomotionModeProperty.delete()
	restOnStopProperty.delete()
	semanticDriverProperty.delete()
	semanticPeriodProperty.delete()
	if (previousLoopMarkerColor === undefined) 
		delete markerColors[-1]
	else 
		markerColors[-1] = previousLoopMarkerColor
})
}
