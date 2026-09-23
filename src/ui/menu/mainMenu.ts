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
import { compileProceduralMotion, defaultProceduralMotion, ProceduralMotionSimulation, ProjectProceduralMotion, solveChainPivots } from '../../proceduralMotion'
import { safeFunctionName } from '../../util/replace'
// @ts-ignore
import logo from '../../assets/itemsadder_icon.png'

declare const BarMenu: any
declare const MenuBar: any
declare const Format: any
declare const Project: any
declare const Blockbench: any
declare const Keybind: any
declare const Dialog: any
declare const Animation: any
declare const AnimationController: any
declare const Animator: any
declare const Modes: any
declare const Group: any
declare const Outliner: any
declare const Canvas: any
declare const THREE: any
declare function guid(): string

const FLIGHT_CONTROLLER = 'controller.itemsadder.flight_blend'
const TURN_VARIABLE = 'variable.itemsadder_flight_turn'

function animationOptions() {
	return Object.fromEntries([['', 'None'], ...Animation.all.map((animation: any) => [animation.uuid, animation.name])])
}

function removeFlightController() {
	const controller = AnimationController.all.find((entry: any) => entry.name === FLIGHT_CONTROLLER)
	if (controller) AnimationController.all.splice(AnimationController.all.indexOf(controller), 1)
}

function syncFlightController(config: any, preview: boolean) {
	if (!config?.straight) {
		removeFlightController()
		return
	}
	const selected = [config.straight, config.left, config.right].map(uuid => Animation.all.find((animation: any) => animation.uuid === uuid))
	if (!selected[0]) return
	const complete = !!selected[1] && !!selected[2]
	const links = complete ? [
		[selected[0], `1 - math.abs(${TURN_VARIABLE})`],
		[selected[1], `math.max(-${TURN_VARIABLE}, 0)`],
		[selected[2], `math.max(${TURN_VARIABLE}, 0)`],
	] : [[selected[0], '1']]
	const animations = links.map(([animation, blend_value]: any[]) => ({
		uuid: guid(), key: animation.getShortName(), animation: animation.uuid, blend_value,
	}))
	let controller = AnimationController.all.find((entry: any) => entry.name === FLIGHT_CONTROLLER)
	const current = controller?.states?.[0]?.animations
	const unchanged = controller?.states?.length === 1 && current?.length === animations.length
		&& animations.every((animation: any, index: number) => current[index].animation === animation.animation
			&& current[index].blend_value === animation.blend_value)
	if (!unchanged) {
		const state = { name: 'flight', animations }
		if (controller) controller.extend({ name: FLIGHT_CONTROLLER, states: [state] })
		else controller = new AnimationController({ name: FLIGHT_CONTROLLER, states: [state] }).add(false)
	}
	if (preview) Modes.options.animate.select()
	Animator.global_variable_lines[TURN_VARIABLE] = String(config.previewTurn ?? 0)
	if (preview) {
		if (AnimationController.selected !== controller) controller.select()
		if (controller.selected_state !== controller.states[0]) controller.states[0].select()
		Animator.preview(false)
	}
}

function flightBlendConfig(result: any) {
	return {
		straight: result.straight || '', left: result.left || '', right: result.right || '',
		previewTurn: Math.max(-1, Math.min(1, Number(result.previewTurn) || 0)),
		deadzone: Number(result.deadzone ?? 0.5), maxTurnRate: Number(result.maxTurnRate ?? 8),
		smoothing: Number(result.smoothing ?? 0.35),
	}
}

function showFlightBlend() {
	const original = Project.flightBlend ? JSON.parse(JSON.stringify(Project.flightBlend)) : undefined
	const value = original || { straight: '', left: '', right: '', previewTurn: 0, deadzone: 0.5, maxTurnRate: 8, smoothing: 0.35 }
	new Dialog({
		id: 'iaentitymodel_flight_blend', title: 'Flight Blend',
		form: {
			straight: { label: 'Straight flight animation', type: 'select', value: value.straight, options: animationOptions() },
			left: { label: 'Turn left animation', type: 'select', value: value.left, options: animationOptions() },
			right: { label: 'Turn right animation', type: 'select', value: value.right, options: animationOptions() },
			previewTurn: { label: 'Preview turn', type: 'range', value: value.previewTurn, min: -1, max: 1, step: 0.01, editable_range_label: true, full_width: true },
			advanced: { label: 'Advanced tuning', type: 'checkbox', value: false },
			deadzone: { label: 'Deadzone (degrees/tick)', type: 'number', value: value.deadzone, min: 0, max: 179, step: 0.1, condition: (form: any) => form.advanced },
			maxTurnRate: { label: 'Full turn rate (degrees/tick)', type: 'number', value: value.maxTurnRate, min: 0.1, max: 180, step: 0.1, condition: (form: any) => form.advanced },
			smoothing: { label: 'Responsiveness', type: 'range', value: value.smoothing, min: 0.01, max: 1, step: 0.01, editable_range_label: true, condition: (form: any) => form.advanced },
		},
		onFormChange(result: any) { syncFlightController(flightBlendConfig(result), true) },
		onConfirm(result: any) {
			const config = flightBlendConfig(result)
			if (config.maxTurnRate <= config.deadzone) {
				Blockbench.showQuickMessage('Full turn rate must be greater than the deadzone', 4000)
				return
			}
			const clips = [config.straight, config.left, config.right].filter(Boolean).map(uuid => Animation.all.find((animation: any) => animation.uuid === uuid))
			if (clips.length === 3 && clips.some(animation => Math.abs(animation.length - clips[0].length) > 1e-6)) {
				Blockbench.showQuickMessage('Flight Blend clips must have the same cycle length', 4000)
				return
			}
			if (clips.length === 3) {
				clips[0].animType = 'fly'
				clips[1].animType = clips[2].animType = 'other'
			}
			Project.flightBlend = config.straight ? config : undefined
			Project.saved = false
			syncFlightController(Project.flightBlend, true)
			this.hide()
		},
		onCancel() { syncFlightController(original, true) },
	}).show()
}

function showProceduralMotion() {
	const original: ProjectProceduralMotion | undefined = Project.proceduralMotion
		? JSON.parse(JSON.stringify(Project.proceduralMotion)) : undefined
	const value: ProjectProceduralMotion = { ...defaultProceduralMotion(), ...(original || {}),
		neck: [...(original?.neck || [])], tail: [...(original?.tail || [])] }
	const root = document.createElement('div')
	root.className = 'ia-procedural-motion'
	root.innerHTML = `<style>
		.ia-procedural-motion fieldset{margin:8px 0;padding:8px;border:1px solid var(--color-border)}
		.ia-procedural-motion label{display:grid;grid-template-columns:145px 1fr;align-items:center;gap:8px;margin:5px 0}
		.ia-procedural-motion ol{margin:4px 0;padding-left:24px}.ia-procedural-motion li{margin:3px 0}
		.ia-procedural-motion li button{float:right;margin-left:3px}.ia-procedural-motion .actions{display:flex;gap:5px;flex-wrap:wrap}
		.ia-procedural-motion .error{color:var(--color-error);min-height:20px}
	</style>`
	const fieldset = (title: string) => { const node = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = title; node.append(legend); root.append(node); return node }
	const row = (parent: HTMLElement, label: string, input: HTMLElement) => { const node = document.createElement('label'); const text = document.createElement('span'); text.textContent = label; node.append(text, input); parent.append(node); return input }
	const checkbox = (checked: boolean) => { const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; return input }
	const range = (min: number, max: number, step: number, current: number) => { const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(current); return input }
	const select = (options: [string, string][], current = '') => { const input = document.createElement('select'); for (const [id, label] of options) { const option = document.createElement('option'); option.value = id; option.textContent = label; option.selected = id === current; input.append(option) } return input }
	const button = (label: string, click: () => void) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.addEventListener('click', click); return node }
	const groups = () => Group.all.filter((group: any) => group.export !== false)
	const boneOptions = () => [['', 'None'], ...groups().map((group: any) => [group.uuid, group.name])] as [string, string][]
	const enabled = row(root, 'Enable', checkbox(value.enabled)) as HTMLInputElement
	const preset = row(root, 'Preset', select([['dragon', 'Dragon'], ['vanilla_ender_dragon', 'Vanilla Ender Dragon'], ['custom', 'Custom']], value.preset)) as HTMLSelectElement
	const bodySection = fieldset('Body and Head')
	const rootBone = row(bodySection, 'Root bone (optional)', select(boneOptions(), value.root)) as HTMLSelectElement
	const body = row(bodySection, 'Body bone', select(boneOptions(), value.body)) as HTMLSelectElement
	const head = row(bodySection, 'Head bone (optional)', select(boneOptions(), value.head)) as HTMLSelectElement
	const frameSection = fieldset('Shared body frame')
	const frameAnchor = row(frameSection, 'Bank anchor', select(boneOptions(), value.bodyFrame?.anchor)) as HTMLSelectElement
	const frameTargets = [...(value.bodyFrame?.targets || [])]
	const frameList = document.createElement('ol'); frameSection.append(frameList)
	const framePivot = [0, 1, 2].map(axis => {
		const input = document.createElement('input'); input.type = 'number'; input.step = '0.0625'
		input.value = String(value.bodyFrame?.pivot[axis] ?? 0)
		row(frameSection, `Bank pivot ${'XYZ'[axis]} (blocks)`, input)
		return input
	})
	const error = document.createElement('div'); error.className = 'error'; root.append(error)

	let simulation: ProceduralMotionSimulation | undefined
	let restWorld = new Map<string, any>()
	let restLocal = new Map<string, any>(), chainFrames = new Map<string, any>()
	let previewYaw = 0, previewY = 0, previewTick = 0, timer: any
	const previewSection = fieldset('Preview')
	const turn = row(previewSection, 'Turn (Left / Right)', range(-1, 1, 0.01, 0)) as HTMLInputElement
	const verticalInput = row(previewSection, 'Vertical (Down / Up)', range(-1, 1, 0.01, 0)) as HTMLInputElement
	const speed = row(previewSection, 'Speed', range(0, 1, 0.01, 0.7)) as HTMLInputElement
	const previewActions = document.createElement('div'); previewActions.className = 'actions'; previewSection.append(previewActions)
	let playButton: HTMLButtonElement

	const advanced = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Advanced'; advanced.append(summary); root.append(advanced)
	const historyTicks = row(advanced, 'History span (ticks)', range(2, 64, 1, value.historyTicks)) as HTMLInputElement
	const bodyBank = row(advanced, 'Body banking', range(0, 2, 0.01, value.bodyBank)) as HTMLInputElement
	const headFollow = row(advanced, 'Head follow', range(0, 2, 0.01, value.headFollow)) as HTMLInputElement
	const vertical = row(advanced, 'Vertical influence', range(0, 2, 0.01, value.vertical)) as HTMLInputElement
	const wave = row(advanced, 'Subtle wave', range(0, 2, 0.01, value.wave)) as HTMLInputElement

	const read = () => {
		value.enabled = enabled.checked; value.preset = preset.value as ProjectProceduralMotion['preset']
		value.root = rootBone.value || undefined; value.body = body.value || undefined; value.head = head.value || undefined
		value.historyTicks = Number(historyTicks.value); value.bodyBank = Number(bodyBank.value)
		value.headFollow = Number(headFollow.value); value.vertical = Number(vertical.value); value.wave = Number(wave.value)
		value.bodyFrame = frameTargets.length ? { anchor: frameAnchor.value, targets: [...frameTargets],
			pivot: framePivot.map(input => Number(input.value)) as [number, number, number] } : undefined
		return value
	}
	const setError = (message = '') => { error.textContent = message }
	const selectedGroups = () => {
		const selected = [...(Array.isArray(Group.selected) ? Group.selected : []), ...(Outliner?.selected || [])]
		return [...new Set(selected.filter((entry: any) => groups().includes(entry)))] as any[]
	}
	const validate = () => {
		read()
		const existing = new Set(groups().map((group: any) => group.uuid))
		for (const [label, ids] of [['Root bone', value.root ? [value.root] : []], ['Body bone', value.body ? [value.body] : []], ['Head bone', value.head ? [value.head] : []], ['Neck chain', value.neck], ['Tail chain', value.tail]] as [string, string[]][]) {
			if (ids.some(id => !existing.has(id))) return `${label} contains a missing bone`
			if (new Set(ids).size !== ids.length) return `This ${label.toLowerCase()} contains the same bone twice`
		}
		const all = [value.root, value.body, value.head, ...value.neck, ...value.tail].filter(Boolean) as string[]
		if (new Set(all).size !== all.length) return 'The same bone is assigned more than once'
		if (value.enabled && !all.length) return 'Choose at least one body, head, neck or tail bone'
		if (value.bodyFrame && (!value.body || !existing.has(value.bodyFrame.anchor)
			|| value.bodyFrame.targets.some(id => !existing.has(id))
			|| new Set(value.bodyFrame.targets).size !== value.bodyFrame.targets.length
			|| value.bodyFrame.pivot.some(coordinate => !Number.isFinite(coordinate) || Math.abs(coordinate) > 1024)))
			return 'Shared body frame needs a valid body, anchor, targets and pivot'
		return ''
	}
	const renderFrameTargets = () => {
		frameList.replaceChildren()
		for (const [index, uuid] of frameTargets.entries()) {
			const item = document.createElement('li')
			item.textContent = groups().find((group: any) => group.uuid === uuid)?.name || '[Missing bone]'
			item.append(button('×', () => { frameTargets.splice(index, 1); renderFrameTargets(); rebuildSimulation() }))
			frameList.append(item)
		}
	}
	frameSection.append(button('Add selected body-frame targets', () => {
		for (const group of selectedGroups()) if (!frameTargets.includes(group.uuid)) frameTargets.push(group.uuid)
		renderFrameTargets(); rebuildSimulation()
	}), button('Clear body-frame targets', () => {
		frameTargets.length = 0; renderFrameTargets(); rebuildSimulation()
	}))
	renderFrameTargets()
	frameAnchor.addEventListener('change', rebuildSimulation)
	for (const input of framePivot) input.addEventListener('change', rebuildSimulation)
	function rebuildSimulation() {
		const message = validate(); setError(message)
		if (message) { simulation = undefined; return }
		const config = compileProceduralMotion(read(), groups())
		simulation = config ? new ProceduralMotionSimulation(config, previewYaw, previewY) : undefined
		Animator.showDefaultPose()
		for (const group of groups()) group.mesh?.updateWorldMatrix?.(true, false)
		restWorld = new Map(groups().filter((group: any) => group.mesh).map((group: any) =>
			[safeFunctionName(group.name), group.mesh.matrixWorld.clone()]))
		restLocal = new Map(groups().filter((group: any) => group.mesh).map((group: any) =>
			[safeFunctionName(group.name), group.mesh.matrix.clone()]))
		chainFrames = new Map()
		for (const chain of [config?.neck, config?.tail]) for (const [index, name] of (chain?.bones || []).entries()) {
			const group = groups().find((candidate: any) => safeFunctionName(candidate.name) === name)
			const other = chain!.bones[index + 1] || (chain === config?.neck && config?.head?.bone)
				|| chain!.bones[index - 1]
			if (!group || !other) continue
			const parent = group.parent?.mesh ? restWorld.get(safeFunctionName(group.parent.name))?.clone().invert() : undefined
			const origin = new THREE.Vector3().setFromMatrixPosition(restWorld.get(name))
			const next = new THREE.Vector3().setFromMatrixPosition(restWorld.get(other))
			const target = next.sub(origin)
			if (index + 1 >= chain!.bones.length && !(chain === config?.neck && config?.head?.bone)) target.negate()
			const source = new THREE.Vector3(0, 0, -1).transformDirection(restWorld.get(name))
			const up = new THREE.Vector3(0, 1, 0).transformDirection(restWorld.get(name))
			if (parent) { source.transformDirection(parent); target.transformDirection(parent); up.transformDirection(parent) }
			target.normalize()
			chainFrames.set(name, source.dot(target) < -.9999
				? new THREE.Quaternion().setFromAxisAngle(up, Math.PI)
				: new THREE.Quaternion().setFromUnitVectors(source, target))
		}
		Animator.preview(false)
	}
	const applyPreview = () => {
		if (!simulation) return
		previewYaw += Number(turn.value) * 8 * Number(speed.value)
		previewY += Number(verticalInput.value) * 0.15 * Number(speed.value)
		const telemetry = simulation.advance(previewYaw, previewY); previewTick++
		Animator.preview(false)
		const authoredLocal = new Map(groups().filter((group: any) => group.mesh).map((group: any) =>
			[safeFunctionName(group.name), Array.from(group.mesh.matrix.elements)]))
		const absolute = new Map(telemetry.map(value => [value.bone, value.rotation]))
		const configured = simulation.config
		const chainBones = new Set([...(configured.neck?.bones || []), ...(configured.tail?.bones || [])])
		const propagationLocal = new Map<string, any>()
		for (const entry of telemetry) {
			const group = groups().find((candidate: any) => safeFunctionName(candidate.name) === entry.bone)
			if (!group?.mesh) continue
			if (chainBones.has(entry.bone)) {
				const radians = entry.rotation.map(value => value * Math.PI / 180)
				const euler = new THREE.Euler().setFromQuaternion(group.mesh.quaternion, 'ZYX')
				const restRotation = new THREE.Quaternion()
				restLocal.get(entry.bone).decompose(new THREE.Vector3(), restRotation, new THREE.Vector3())
				const frame = chainFrames.get(entry.bone) || new THREE.Quaternion()
				const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
					euler.x - radians[0], euler.y - radians[1], euler.z, 'ZYX'))
				const propagated = frame.clone().multiply(delta).multiply(restRotation.clone().invert())
					.multiply(frame.clone().invert()).multiply(restRotation).normalize()
				propagationLocal.set(entry.bone, new THREE.Matrix4().compose(group.mesh.position, propagated, group.mesh.scale))
				group.mesh.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), radians[2])
					.multiply(propagated)).normalize()
				group.mesh.updateMatrix?.()
				continue
			}
			if (configured.root?.bone === entry.bone) {
				const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
					-entry.rotation[0] * Math.PI / 180, entry.rotation[1] * Math.PI / 180,
					-entry.rotation[2] * Math.PI / 180, 'ZYX'))
				group.mesh.position.applyQuaternion(delta); group.mesh.quaternion.premultiply(delta).normalize()
				group.mesh.updateMatrix?.()
				continue
			}
			let parent = group.parent, parentRotation: number[] | undefined
			while (parent) { if (typeof parent.name === 'string' && chainBones.has(safeFunctionName(parent.name))) parentRotation = absolute.get(safeFunctionName(parent.name)); if (parentRotation) break; parent = parent.parent }
			const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
				(entry.rotation[0] - (parentRotation?.[0] || 0)) * Math.PI / 180,
				-(entry.rotation[1] - (parentRotation?.[1] || 0)) * Math.PI / 180,
				(configured.bodyFrame && configured.body?.bone === entry.bone ? 0
					: entry.rotation[2] - (parentRotation?.[2] || 0)) * Math.PI / 180, 'ZYX'))
			group.mesh.quaternion.multiply(delta).normalize()
			group.mesh.updateMatrix?.()
		}
		for (const group of groups()) group.mesh?.updateWorldMatrix?.(true, false)
		const byName = new Map(groups().map((group: any) => [safeFunctionName(group.name), group]))
		for (const [name, group] of byName as any) if (group.mesh && !propagationLocal.has(name)) propagationLocal.set(name, group.mesh.matrix.clone())
		const frameWorld = new Map<string, any>(), independentWorld = new Map<string, any>(), propagationWorld = new Map<string, any>()
		const resolveFrames = (group: any): any => {
			const name = safeFunctionName(group.name); const cached = frameWorld.get(name); if (cached) return cached
			const parent = group.parent?.mesh ? resolveFrames(group.parent) : new THREE.Matrix4()
			const authored = authoredLocal.get(name)
			const frameLocal = chainBones.has(name) && authored ? new THREE.Matrix4().fromArray(authored) : group.mesh.matrix
			const frame = parent.clone().multiply(frameLocal)
			frameWorld.set(name, frame)
			independentWorld.set(name, parent.clone().multiply(group.mesh.matrix))
			propagationWorld.set(name, parent.clone().multiply(propagationLocal.get(name) || group.mesh.matrix))
			return frame
		}
		for (const [, group] of byName as any) if (group.mesh) resolveFrames(group)
		const targets = new Map<string, any>(), spatial: any[] = []
		let attachment: any
		for (const chain of [configured.neck, configured.tail]) {
			if (!chain?.bones.length) continue
			const first = chain.bones[0], firstBase = independentWorld.get(first)
			if (!firstBase) continue
			const pivots: number[][] = [new THREE.Vector3().setFromMatrixPosition(firstBase).toArray()]
			for (const [index, bone] of chain.bones.entries()) {
				const target = independentWorld.get(bone).clone()
				target.setPosition(...pivots[index]); targets.set(bone, target)
				spatial.push({ bone, pivot: pivots[index], segmentLength: index ? Math.hypot(
					...pivots[index].map((value, axis) => value - pivots[index - 1][axis])) : 0 })
				if (index + 1 < chain.bones.length) {
					const from = new THREE.Vector3().setFromMatrixPosition(restWorld.get(bone))
					const direction = new THREE.Vector3().setFromMatrixPosition(restWorld.get(chain.bones[index + 1])).sub(from)
					const delta = propagationWorld.get(bone).clone().setPosition(...pivots[index]).multiply(restWorld.get(bone).clone().invert())
					direction.applyMatrix3(new THREE.Matrix3().setFromMatrix4(delta))
					pivots.push(direction.add(new THREE.Vector3(...pivots[index])).toArray())
				}
			}
		}
		if (configured.neck?.bones.length && configured.head) {
			const terminal = configured.neck.bones.at(-1)!
			const terminalTarget = targets.get(terminal), terminalRest = restWorld.get(terminal), headRest = restWorld.get(configured.head.bone), headBase = independentWorld.get(configured.head.bone)
			if (terminalTarget && terminalRest && headRest && headBase) {
				const endpoint = new THREE.Vector3().setFromMatrixPosition(headRest).sub(new THREE.Vector3().setFromMatrixPosition(terminalRest))
				const pivot = new THREE.Vector3().setFromMatrixPosition(terminalTarget)
				const delta = propagationWorld.get(terminal).clone().setPosition(pivot).multiply(terminalRest.clone().invert())
				endpoint.applyMatrix3(new THREE.Matrix3().setFromMatrix4(delta)).add(pivot)
				const target = headBase.clone().setPosition(endpoint)
				targets.set(configured.head.bone, target)
				attachment = { terminal, bone: configured.head.bone,
					before: Array.from(headBase.elements), target: Array.from(target.elements) }
			}
		}
		if (configured.bodyFrame && configured.body) {
			const anchor = byName.get(configured.bodyFrame.anchor) as any
			const bodyRotation = absolute.get(configured.body.bone)?.[2] || 0
			if (anchor?.mesh) {
				const [x, y, z] = configured.bodyFrame.pivot.map(value => value * 16)
				const bank = anchor.mesh.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z))
					.multiply(new THREE.Matrix4().makeRotationZ(bodyRotation * Math.PI / 180))
					.multiply(new THREE.Matrix4().makeTranslation(-x, -y, -z))
					.multiply(anchor.mesh.matrixWorld.clone().invert())
				for (const name of configured.bodyFrame.targets) {
					const group = byName.get(name) as any
					if (group?.mesh) targets.set(name, bank.clone().multiply(group.mesh.matrixWorld))
				}
			}
		}
		const depth = (group: any) => { let value = 0; for (let parent = group.parent; parent; parent = parent.parent) value++; return value }
		for (const group of [...groups()].sort((left: any, right: any) => depth(left) - depth(right))) {
			const target = targets.get(safeFunctionName(group.name))
			if (target) {
				const local = target.clone()
				if (group.mesh.parent) local.premultiply(group.mesh.parent.matrixWorld.clone().invert())
				const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
				local.decompose(position, quaternion, scale)
				group.mesh.position.copy(position); group.mesh.quaternion.copy(quaternion); group.mesh.scale.copy(scale)
			}
			group.mesh.updateMatrix?.(); group.mesh.updateWorldMatrix?.(false, false)
		}
		if (attachment) {
			const actual = (byName.get(attachment.bone) as any)?.mesh?.matrixWorld
			attachment.actual = actual ? Array.from(actual.elements) : undefined
			attachment.beforePivotError = Math.hypot(...[12, 13, 14].map(index => attachment.before[index] - attachment.target[index]))
			attachment.afterMatrixError = actual ? Math.max(...actual.elements.map((value: number, index: number) => Math.abs(value - attachment.target[index]))) : Infinity
		}
		Canvas.updateAllPositions?.()
		const bones = Object.fromEntries(groups().filter((group: any) => group.mesh).map((group: any) => {
			const name = safeFunctionName(group.name)
			return [name, { authoredLocal: authoredLocal.get(name), local: Array.from(group.mesh.matrix.elements),
				world: Array.from(group.mesh.matrixWorld.elements) }]
		}))
		;(globalThis as any).IA_PROCEDURAL_PREVIEW = { tick: previewTick, yaw: previewYaw, y: previewY,
			input: { turn: Number(turn.value), vertical: Number(verticalInput.value), speed: Number(speed.value) }, telemetry, spatial,
			attachments: attachment ? [attachment] : [], bones }
	}
	const stopPreview = () => { if (timer) clearInterval(timer); timer = undefined; if (playButton) playButton.textContent = 'Play Motion Preview'; Animator.preview(false) }
	const resetPreview = () => { previewYaw = previewY = previewTick = 0; rebuildSimulation(); Animator.preview(false); (globalThis as any).IA_PROCEDURAL_PREVIEW = undefined }
	playButton = button('Play Motion Preview', () => {
		if (timer) { stopPreview(); return }
		rebuildSimulation(); if (!simulation) return
		playButton.textContent = 'Pause Motion Preview'; timer = setInterval(applyPreview, 50)
	})
	previewActions.append(playButton, button('Reset History', resetPreview))

	const renderChains: (() => void)[] = []
	const chainEditor = (title: string, key: 'neck' | 'tail') => {
		const section = fieldset(title); const list = document.createElement('ol'); section.append(list)
		const follow = row(section, 'Follow', range(0, 2, 0.01, value[`${key}Follow`])) as HTMLInputElement
		const flexibility = row(section, 'Flexibility', range(0, 1, 0.01, value[`${key}Flexibility`])) as HTMLInputElement
		const render = () => {
			list.replaceChildren()
			for (const [index, uuid] of value[key].entries()) {
				const item = document.createElement('li'); item.textContent = groups().find((group: any) => group.uuid === uuid)?.name || '[Missing bone]'
				item.append(button('×', () => { value[key].splice(index, 1); render(); rebuildSimulation() }),
					button('↓', () => { if (index + 1 < value[key].length) [value[key][index], value[key][index + 1]] = [value[key][index + 1], value[key][index]]; render(); rebuildSimulation() }),
					button('↑', () => { if (index) [value[key][index - 1], value[key][index]] = [value[key][index], value[key][index - 1]]; render(); rebuildSimulation() }))
				list.append(item)
			}
		}
		const actions = document.createElement('div'); actions.className = 'actions'
		actions.append(button(`Add selected bones as ${title}`, () => {
			const selected = selectedGroups(); if (!selected.length) { setError('Select one or more bones first'); return }
			if (selected.some(group => [value.root, value.body, value.head, ...value.neck, ...value.tail].includes(group.uuid))) { setError('The same bone is assigned more than once'); return }
			value[key].push(...selected.map(group => group.uuid)); render(); rebuildSimulation()
		}), button('Clear chain', () => { value[key].length = 0; render(); rebuildSimulation() }))
		section.append(actions); render(); renderChains.push(render)
		follow.addEventListener('input', () => { value[`${key}Follow`] = Number(follow.value); rebuildSimulation() })
		flexibility.addEventListener('input', () => { value[`${key}Flexibility`] = Number(flexibility.value); rebuildSimulation() })
		return section
	}
	root.insertBefore(chainEditor('Neck Chain', 'neck'), previewSection)
	root.insertBefore(chainEditor('Tail Chain', 'tail'), previewSection)
	const autoMap = button('Auto-map obvious dragon names', () => {
		const all = groups(); const exact = (pattern: RegExp) => all.find((group: any) => pattern.test(group.name))?.uuid
		value.root = exact(/^root$/i); value.body = exact(/^(body_bank|body|core)$/i); value.head = exact(/^head$/i)
		value.neck = all.filter((group: any) => /(neck|cervical)/i.test(group.name)).map((group: any) => group.uuid)
		value.tail = all.filter((group: any) => /tail/i.test(group.name)).map((group: any) => group.uuid)
		rootBone.value = value.root || ''; body.value = value.body || ''; head.value = value.head || ''
		frameAnchor.value = value.root || ''; renderChains.forEach(render => render()); rebuildSimulation()
	})
	root.insertBefore(autoMap, bodySection)
	for (const input of [enabled, preset, rootBone, body, head, historyTicks, bodyBank, headFollow, vertical, wave]) input.addEventListener('change', rebuildSimulation)

	const dialog = new Dialog({
		id: 'iaentitymodel_procedural_motion', title: 'Procedural Flight Motion', lines: [root], buttons: ['Save', 'Cancel'],
		onConfirm() {
			const message = validate(); setError(message); if (message) return
			Project.proceduralMotion = JSON.parse(JSON.stringify(read())); Project.saved = false; stopPreview(); this.hide()
		},
		onCancel() { stopPreview(); Project.proceduralMotion = original; },
	}).show()
	rebuildSimulation()
}

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
			name: 'Flight Blend', id: 'iaentitymodel.flight_blend', icon: 'flight',
			condition: () => isItemsAdderProjectOpen() && settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings),
			click: showFlightBlend,
		},
		'iaentitymodel'
	)
	MenuBar.addAction(
		{
			name: 'Procedural Flight Motion', id: 'iaentitymodel.procedural_motion', icon: 'waves',
			condition: () => isItemsAdderProjectOpen() && settings.iaentitymodel.entityFormat === 'v2' && !isInternalModel(settings),
			click: showProceduralMotion,
		},
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
	const onLoadProject = () => queueMicrotask(() => syncFlightController(Project?.flightBlend, false))
	Blockbench.on('new_project', onNewProject)
	Blockbench.on('load_project', onLoadProject)
	bus.on(EVENTS.LIFECYCLE.CLEANUP, () => {
		menu.label.remove()
		Blockbench.removeListener('new_project', onNewProject)
		Blockbench.removeListener('load_project', onLoadProject)
	})

	return menu
}
