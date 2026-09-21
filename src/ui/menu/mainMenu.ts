import { tl } from '../../util/intl'
import { store } from '../../util/store'
import { bus } from '../../util/bus'
import EVENTS from '../../constants/events'
import { CustomAction } from '../../util/customAction'
import { format as modelFormat } from '../../modelFormat'
import { resetProjectSettings } from '../../settings/projectSettings'
import { settings } from '../../settings'
import { isInternalModel } from '../../util/utilz'
import { show_settings } from '../dialogs/settings'
import { show_about } from '../dialogs/about'
// @ts-ignore
import logo from '../../assets/itemsadder_icon.png'

declare const BarMenu: any
declare const MenuBar: any
declare const Format: any
declare const Project: any
declare const Blockbench: any
declare const Keybind: any

function createMenuLabel(menu: any) {
	menu.label.innerHTML = tl('iaentitymodel.menubar.dropdown')
	const img = document.createElement('img')
	img.src = logo
	img.width = 16
	img.height = 16
	img.style.position = 'relative'
	img.style.top = '2px'
	img.style.borderRadius = '8px'
	img.style.marginRight = '5px'
	menu.label.prepend(img)
}

function isItemsAdderProjectOpen() {
	return !!Project && Format.id === modelFormat.id
}

function runSelectedExporter() {
	if (!Project) return
	if ((!Project.save_path || Project.save_path === '') && Project.export_path) {
		Project.save_path = Project.export_path
	}

	if (!Project.save_path || Project.save_path === '') {
		Blockbench.showQuickMessage(tl('iaentitymodel.popups.projectNotSaved'))
		return
	}

	const exporter = store.getStore('exporters')?.get?.('vanillaAnimationExporter')
	if (typeof exporter !== 'function') {
		Blockbench.showQuickMessage('Animation exporter is not ready')
		return
	}
	exporter()
}

export function registerMainMenu() {
	const menu: any = new BarMenu(
		'iaentitymodel',
		[],
		isItemsAdderProjectOpen
	)
	createMenuLabel(menu)
	menu.label.style.display = isItemsAdderProjectOpen() ? 'inline-block' : 'none'

	MenuBar.addAction(
		CustomAction('iaentitymodel_settings', {
			icon: 'settings',
			category: 'iaentitymodel',
			name: tl('iaentitymodel.menubar.settings'),
			condition: isItemsAdderProjectOpen,
			click: function () {
				show_settings()
			},
		}),
		'iaentitymodel'
	)
	MenuBar.addAction(
		{
			name: tl('iaentitymodel.menubar.export'),
			id: 'iaentitymodel.export',
			icon: 'insert_drive_file',
			condition: isItemsAdderProjectOpen,
			click: runSelectedExporter,
			keybind: new Keybind({
				key: 120,
			}),
		},
		'iaentitymodel'
	)
	MenuBar.addAction(
		CustomAction('iaentitymodel_about', {
			icon: 'help',
			category: 'iaentitymodel',
			name: tl('iaentitymodel.menubar.about'),
			condition: isItemsAdderProjectOpen,
			click: function () {
				show_about()
			},
		}),
		'iaentitymodel'
	)
	MenuBar.addAction(CustomAction('iaentitymodel_convert_v2', {
		name: 'Convert project to Custom Entities V2',
		icon: 'upgrade',
		condition: () => isItemsAdderProjectOpen() && !isInternalModel(settings) && settings.iaentitymodel.entityFormat !== 'v2',
		click() {
			settings.update({ iaentitymodel: {
				entityFormat: 'v2',
				projectName: settings.iaentitymodel.projectName + '_v2',
			} })
			Project.saved = false
			Blockbench.showQuickMessage('Converted to V2. Export uses a new _v2 model folder; save this project as a copy to keep the original.')
		},
	}), 'iaentitymodel')
	MenuBar.update()

	const onNewProject = () => {
		store.set('states', { default: {} })
		resetProjectSettings()
		bus.dispatch(EVENTS.LIFECYCLE.LOAD_MODEL, {})
	}
	Blockbench.on('new_project', onNewProject)
	bus.on(EVENTS.LIFECYCLE.CLEANUP, () => {
		menu.label.remove()
		Blockbench.removeListener('new_project', onNewProject)
	})

	return menu
}
