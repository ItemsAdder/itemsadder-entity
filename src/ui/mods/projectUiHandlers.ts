import { bus } from '../../util/bus'
import EVENTS from '../../constants/events'
import { format as modelFormat } from '../../modelFormat'
import { settings } from '../../settings'
import { isInternalModel, refreshGroupsProperties } from '../../util/utilz'
import { INTERNAL_PLAYER_SUS_BONE_UUID } from '../../constants/internalPlayer'
import { setVariablePlaceholdersVisible } from '../adapters/variablePlaceholders'
import { clearInvalidCubeNotification } from '../notifications/invalidCube'
import {
	ensureUserCubeHasEditableParent,
	hideBuiltinPlayerEditParts,
	hideEditPaintTabs,
	preventBuiltinPlayerPaintSelection,
	restoreEditPaintTabs,
	restoreHiddenUI,
} from './playerEmoteEditing'
import { normalizeAllHeadBoneCubes } from './headBoneChildren'

declare const Blockbench: any
declare const Format: any
declare const Interface: any
declare const Modes: any
declare const Group: any
declare const Canvas: any
declare const Project: any
declare function updateSelection(): void

function isItemsAdderProject() {
	return !!Project && Format.id === modelFormat.id
}

function refreshModelUi() {
	if (!isItemsAdderProject()) return
	normalizeAllHeadBoneCubes()
	refreshGroupsProperties()
	hideBuiltinPlayerEditParts()
	preventBuiltinPlayerPaintSelection()
}

function hideVariablePlaceholdersPanel() {
	setVariablePlaceholdersVisible(false)
}

function hideInternalSusBone() {
	const susbone = document.getElementById(INTERNAL_PLAYER_SUS_BONE_UUID)
	if (!susbone) return
	susbone.style.setProperty('display', 'none')
	Group.uuids[INTERNAL_PLAYER_SUS_BONE_UUID]?.children.forEach((child: any) => {
		child.visibility = false
	})
	Canvas.updateVisibility()
}

function afterOutlinerUpdate(callback: () => void) {
	queueMicrotask(() => {
		if (typeof requestAnimationFrame === 'function') {
			requestAnimationFrame(callback)
			return
		}
		callback()
	})
}

function refreshOutlinerAfterGroupChange() {
	const selectedGroup = (Group.selected as any)?.[0]
	afterOutlinerUpdate(() => {
		if (!isItemsAdderProject()) return
		normalizeAllHeadBoneCubes()
		refreshGroupsProperties()
		hideBuiltinPlayerEditParts()

		if (selectedGroup && Group.all.includes(selectedGroup)) {
			selectedGroup.select?.()
			Canvas.updateAllBones?.()
			Canvas.updateAllPositions?.()
			updateSelection?.()
		}
	})
}

export function registerProjectUiHandlers(menu: any) {
	const onSelectProject = () => {
		queueMicrotask(() => {
			menu.label.style.display = isItemsAdderProject() ? 'inline-block' : 'none'

			if (!isItemsAdderProject()) {
				restoreHiddenUI()
				return
			}
			if (globalThis.LONEDEV_DEBUG) return

			refreshModelUi()
			hideVariablePlaceholdersPanel()

			if (isInternalModel(settings)) {
				Modes.options.animate.select()
				hideEditPaintTabs()
			} else {
				Modes.options.edit.select()
				restoreEditPaintTabs()
			}

			hideInternalSusBone()
		})
	}
	const onAddGroup = () => {
		if (!isItemsAdderProject()) return
		refreshOutlinerAfterGroupChange()
	}
	const onAddCube = () => {
		if (!isItemsAdderProject()) return
		queueMicrotask(() => {
			ensureUserCubeHasEditableParent()
			normalizeAllHeadBoneCubes()
			refreshGroupsProperties()
			hideBuiltinPlayerEditParts()
		})
	}
	const onSelectMode = () => {
		if (!isItemsAdderProject()) return
		refreshModelUi()
		restoreEditPaintTabs()
		clearInvalidCubeNotification()
	}
	const onBodyClick = () => {
		refreshModelUi()
	}
	const onUnselectProject = () => {
		menu.label.style.display = 'none'
	}

	Blockbench.on('select_project', onSelectProject)
	Blockbench.on('add_group', onAddGroup)
	Blockbench.on('group_elements', onAddGroup)
	Blockbench.on('add_cube', onAddCube)
	Blockbench.on('select_mode', onSelectMode)
	Blockbench.on('unselect_project', onUnselectProject)
	document.body.addEventListener('click', onBodyClick, true)

	bus.on(EVENTS.LIFECYCLE.CLEANUP, () => {
		Blockbench.removeListener('select_project', onSelectProject)
		Blockbench.removeListener('add_group', onAddGroup)
		Blockbench.removeListener('group_elements', onAddGroup)
		Blockbench.removeListener('add_cube', onAddCube)
		Blockbench.removeListener('select_mode', onSelectMode)
		Blockbench.removeListener('unselect_project', onUnselectProject)
		document.body.removeEventListener('click', onBodyClick, true)
	})
}
