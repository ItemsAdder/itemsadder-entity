'use strict'

const fs = require('fs')
const path = require('path')
const { runArtist } = require('./v2-artist-fixture')

const clone = value => JSON.parse(JSON.stringify(value))

function fixture(source, id, mapping) {
	const groupByName = new Map(source.groups.map(group => [group.name, group]))
	const findNode = (nodes, uuid) => {
		for (const node of nodes || []) if (typeof node === 'object') {
			if (node.uuid === uuid) return node
			const nested = findNode(node.children, uuid)
			if (nested) return nested
		}
	}
	const groups = mapping.map(([sourceName, name]) => ({ ...clone(groupByName.get(sourceName)), name }))
	const selected = new Set(groups.map(group => group.uuid))
	const nodes = groups.map(group => {
		const sourceNode = findNode(source.outliner, group.uuid)
		return { uuid: group.uuid, isOpen: true, children: (sourceNode?.children || []).filter(child => typeof child === 'string') }
	})
	const elementIds = new Set(nodes.flatMap(node => node.children))
	const animations = source.animations.map(animation => ({ ...clone(animation), animators: Object.fromEntries(
		Object.entries(animation.animators || {}).filter(([uuid]) => selected.has(uuid)).map(([uuid, animator]) => {
			const name = groups.find(group => group.uuid === uuid).name
			return [uuid, { ...clone(animator), name }]
		})) }))
	const root = nodes[0]
	root.children.push(...nodes.slice(1))
	return { ...clone(source), name: id, groups, elements: source.elements.filter(element => elementIds.has(element.uuid)).map(clone), outliner: [root], animations }
}

function longFixture(source) {
	const mapping = [['root', 'hub'], ...Array.from({ length: 12 }, (_, index) => [`tail${index}`, `ribbon_${String(index).padStart(2, '0')}`])]
	const result = fixture(source, 'long_procedural_chain', mapping)
	const sourceTail = source.groups.find(group => group.name === 'tail11')
	const sourceNode = source.outliner[0].children.find(node => typeof node === 'object' && node.uuid === sourceTail.uuid)
	const sourceElements = sourceNode.children.map(uuid => source.elements.find(element => element.uuid === uuid))
	for (let index = 12; index < 20; index++) {
		const uuid = `d2a69999-0000-4000-8000-${String(index).padStart(12, '0')}`
		const offset = (index - 11) * 10
		result.groups.push({ ...clone(sourceTail), uuid, name: `ribbon_${index}`, origin: sourceTail.origin.map((value, axis) => axis === 2 ? value + offset : value) })
		const children = sourceElements.map((element, child) => {
			const childUuid = `d2a68888-0000-4000-8000-${String(index * 2 + child).padStart(12, '0')}`
			result.elements.push({ ...clone(element), uuid: childUuid,
				from: element.from.map((value, axis) => axis === 2 ? value + offset : value),
				to: element.to.map((value, axis) => axis === 2 ? value + offset : value),
				origin: element.origin.map((value, axis) => axis === 2 ? value + offset : value) })
			return childUuid
		})
		result.outliner[0].children.push({ uuid, isOpen: true, children })
		for (const animation of result.animations) {
			const sourceAnimator = source.animations.find(entry => entry.name === animation.name).animators[sourceTail.uuid]
			if (sourceAnimator) animation.animators[uuid] = { ...clone(sourceAnimator), name: `ribbon_${index}` }
		}
	}
	return result
}

async function run(page, { sourcePath, outputRoot }) {
	const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
	const cases = [
		['short_procedural_dragon', fixture(source, 'short_procedural_dragon', [['root', 'core'], ['head', 'sensor'], ['neck0', 'cervical_a'], ['neck1', 'cervical_b'], ['tail0', 'tail_root'], ['tail1', 'tail_end']]),
			{ preset: 'dragon', body: 'core', head: 'sensor', neck: ['cervical_a', 'cervical_b'], tail: ['tail_root', 'tail_end'] }],
		['long_procedural_chain', longFixture(source),
			{ preset: 'dragon', body: 'hub', neck: [], tail: Array.from({ length: 20 }, (_, index) => `ribbon_${String(index).padStart(2, '0')}`) }],
		['no_tail_flyer', fixture(source, 'no_tail_flyer', [['root', 'keel'], ['head', 'beacon'], ['neck0', 'spine_a'], ['neck1', 'spine_b'], ['neck2', 'spine_c'], ['neck3', 'spine_d']]),
			{ preset: 'dragon', body: 'keel', head: 'beacon', neck: ['spine_a', 'spine_b', 'spine_c', 'spine_d'], tail: [] }],
		['arbitrary_shared_frame', fixture(source, 'arbitrary_shared_frame', [['root', 'hub'], ['body', 'torso'], ['left_wing', 'foil_a'], ['right_wing', 'foil_b'], ['left_front_leg', 'strut']]),
			{ preset: 'dragon', body: 'torso', neck: [], tail: [],
				bodyFrame: { anchor: 'hub', targets: ['torso', 'foil_a', 'strut'], pivot: [0, -1, 0] } }],
	]
	const results = []
	for (const [id, model, proceduralMotion] of cases) {
		const directory = path.join(outputRoot, id)
		fs.mkdirSync(directory, { recursive: true })
		const fixturePath = path.join(directory, `${id}.bbmodel`)
		fs.writeFileSync(fixturePath, JSON.stringify(model, null, 2) + '\n')
		results.push(await runArtist(page, { sourcePath: fixturePath, outputRoot: directory, id,
			namespace: 'ia_v2_procedural', proceduralMotion }))
	}
	return results
}

module.exports = { run }
