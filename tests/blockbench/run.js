#!/usr/bin/env node
'use strict'

const { chromium } = require('playwright')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')

const root = path.resolve(__dirname, '..', '..')
let endpoint
let profile
let child

function requestJson(url) {
	return new Promise((resolve, reject) => {
		const request = http.get(url, (response) => {
			let body = ''
			response.setEncoding('utf8')
			response.on('data', (chunk) => { body += chunk })
			response.on('end', () => {
				if (response.statusCode !== 200) return reject(new Error(`CDP returned ${response.statusCode}`))
				try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
			})
		}).on('error', reject)
		request.setTimeout(2_000, () => request.destroy(new Error('CDP request timed out')))
	})
}

async function waitForCdp() {
	const deadline = Date.now() + 30_000
	let lastError
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`Blockbench exited with ${child.exitCode}; see ${profile}/test-stderr.log`)
		const activePort = path.join(profile, 'DevToolsActivePort')
		if (!endpoint && fs.existsSync(activePort)) {
			const port = Number(fs.readFileSync(activePort, 'utf8').split('\n')[0])
			if (port > 0 && port < 65536) endpoint = `http://127.0.0.1:${port}`
		}
		if (!endpoint) { await new Promise((resolve) => setTimeout(resolve, 100)); continue }
		try { return await requestJson(`${endpoint}/json/version`) } catch (error) { lastError = error }
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	throw new Error(`Blockbench did not expose CDP at ${endpoint}: ${lastError?.message || 'timeout'}`)
}

let stopping
function stop() {
	return stopping ||= (async () => {
		if (!child?.pid) return
		const signalGroup = signal => {
			try { process.kill(-child.pid, signal); return true } catch (error) {
				if (error.code === 'ESRCH') return false
				throw error
			}
		}
		for (const signal of ['SIGTERM', 'SIGKILL']) {
			if (!signalGroup(signal)) break
			const deadline = Date.now() + 5_000
			while (signalGroup(0) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
		}
		const alive = signalGroup(0)
		fs.writeFileSync(path.join(profile, 'test-cleanup.json'), JSON.stringify({ pid: child.pid, pgid: child.pid, alive }))
		if (alive) throw new Error(`Blockbench process group ${child.pid} survived cleanup`)
	})()
}

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
	process.once(signal, () => stop().catch(console.error).finally(() => process.exit(code)))
}

async function main() {
	const display = process.env.BLOCKBENCH_DISPLAY
	const profileRoot = process.env.BLOCKBENCH_PROFILE_DIR
	if (!/^:[1-9][0-9]*$/.test(display || '') || display === ':0') {
		throw new Error('Set BLOCKBENCH_DISPLAY to a private Xvfb display; this test never uses the desktop display')
	}
	if (!profileRoot || !path.isAbsolute(profileRoot)) {
		throw new Error('Set BLOCKBENCH_PROFILE_DIR to a task-owned absolute path exposed to Flatpak')
	}
	fs.mkdirSync(profileRoot, { recursive: true })
	profile = fs.mkdtempSync(path.join(profileRoot, 'run-'))
	// Blockbench 5.1 persists per-plugin native-module grants here. The user authorized
	// this plugin; seed only its actual fs/os dependencies in our disposable profile.
	// Never alter the user's profile or auto-accept arbitrary dialogs/plugins.
	fs.writeFileSync(path.join(profile, 'plugin_permissions.json'), JSON.stringify({
		iaentitymodel: { allowed: { fs: true, os: true } },
	}))
	const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test-fixtures/v2/blockbench/legacy-rig.iaentitymodel'), 'utf8'))
	const invalidFixture = JSON.parse(fs.readFileSync(path.join(root, 'test-fixtures/v2/blockbench/invalid-project.json'), 'utf8'))
	const plugin = path.join(root, 'dist/iaentitymodel.js')
	child = spawn('rtk', ['flatpak',
		'run', '--socket=x11', '--nosocket=wayland', `--filesystem=/tmp/.X11-unix/X${display.slice(1)}`, `--filesystem=${profileRoot}`, `--filesystem=${root}:ro`,
		`--env=DISPLAY=${display}`, '--env=WAYLAND_DISPLAY=', '--env=XDG_SESSION_TYPE=x11',
		'--command=blockbench-run', 'net.blockbench.Blockbench', '--ozone-platform=x11',
		'--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
		'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
		`--user-data-dir=${profile}`, '--no-first-run',
	], {
		detached: true,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, DISPLAY: display, WAYLAND_DISPLAY: '', XDG_SESSION_TYPE: 'x11' },
	})
	fs.writeFileSync(path.join(profile, 'test-process.json'), JSON.stringify({ pid: child.pid, pgid: child.pid, display }))
	child.stdout.pipe(fs.createWriteStream(path.join(profile, 'test-stdout.log')))
	child.stderr.pipe(fs.createWriteStream(path.join(profile, 'test-stderr.log')))
	await waitForCdp()
	console.log('CDP ready')
	const browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 })
	try {
		const page = browser.contexts().flatMap((context) => context.pages())[0]
		if (!page) throw new Error('Blockbench CDP has no renderer page')
		const editorErrors = []
		let invalidFixturePhase = false
		const recordEditorError = (kind, message) => {
			if (invalidFixturePhase && message === 'e is not iterable') return
			else editorErrors.push(`${kind}: ${message}`)
			console.error(`${kind}:`, message)
		}
		page.on('pageerror', error => recordEditorError('Editor error', error.stack || error.message))
		page.on('console', message => {
			if (message.type() === 'error') recordEditorError('Editor console', message.text())
			else if (message.text().startsWith('IAE_V2_STEP ')) console.log(message.text())
		})
		page.setDefaultTimeout(10_000)
		await page.waitForFunction(() => typeof Blockbench !== 'undefined' && typeof Plugin !== 'undefined')
		console.log('Editor ready')
		console.log(await page.evaluate(() => ({ version: Blockbench.version, pages: location.href })))
		await page.evaluate(async (pluginFile) => {
			// This runner owns the isolated profile and explicitly loads this trusted build.
			// `first=true` is the interactive installation path and calls native confirm().
			await new Plugin().loadFromFile({ path: pluginFile, name: 'iaentitymodel.js' }, false)
		}, plugin)
		await page.waitForFunction(() => typeof globalThis.IAENTITY !== 'undefined')
		console.log('Plugin loaded without installation dialog')
		invalidFixturePhase = true
		const invalidRejected = await page.evaluate((invalid) => {
			const codec = Codecs.iaentitymodel
			if (!codec) throw new Error('ItemsAdder codec was not registered')
			try {
				codec.load(invalid, { path: '/tmp/invalid-project.iaentitymodel', no_file: true })
			} catch (_) {
				return true
			}
			return false
		}, invalidFixture)
		await page.waitForTimeout(0)
		invalidFixturePhase = false
		if (!invalidRejected) throw new Error('Malformed legacy project was accepted')
		const result = await page.evaluate((model) => {
			const codec = Codecs.iaentitymodel
			codec.load(model, { path: '/tmp/legacy-rig.iaentitymodel', no_file: true })
			Canvas.updateAll()
			const cube = Cube.all.find((entry) => entry.name === 'cube')
			const child = Group.all.find((entry) => entry.name === 'child')
			if (!cube || !child || !cube.mesh) throw new Error('Legacy fixture did not load its child cube')
			const first = cube.mesh.geometry.attributes.position
			const vertices = Array.from({ length: Math.min(12, first.count * 3) }, (_, i) => first.array[i])
			const matrix = Array.from(cube.mesh.matrixWorld.elements)
			const compile = () => {
				const saved = JSON.parse(codec.compile())
				delete saved.meta.creation_time
				delete saved.meta.backup
				return JSON.stringify(saved)
			}
			const firstExport = compile()
			const secondExport = compile()
			return { matrix, vertices, deterministic: firstExport === secondExport, groups: Group.all.length, cubes: Cube.all.length }
		}, fixture)
		if (!result.deterministic) throw new Error('Legacy codec compile is nondeterministic after volatile timestamp removal')
		if (result.groups < 2 || result.cubes !== 1 || result.matrix.some((value) => !Number.isFinite(value)) || result.vertices.some((value) => !Number.isFinite(value))) {
			throw new Error(`Invalid editor geometry oracle: ${JSON.stringify(result)}`)
		}
		console.log(JSON.stringify({ status: 'PASS', blockbench: 'CDP', ...result, invalidRejected }))
		if (process.env.BLOCKBENCH_TEST_V2 === '1') {
			const output = path.join(profileRoot, 'v2-output')
			const projectPath = path.join(output, 'contents/test/v2_fixture.iaentitymodel')
			fs.mkdirSync(path.dirname(projectPath), { recursive: true })
			await require('./v2-fixture').run(page, { oraclePath: path.join(output, 'oracle.json'), projectPath })
			console.log(JSON.stringify({ status: 'PASS', test: 'v2-editor-export', output }))
		}
		if (process.env.BLOCKBENCH_TEST_V2_GEOMETRY === '1') {
			const output = path.join(profileRoot, 'v2-geometry-output')
			const projectPath = path.join(output, 'contents/test/v2_geometry_fixture.iaentitymodel')
			fs.mkdirSync(path.dirname(projectPath), { recursive: true })
			const result = await require('./v2-geometry-fixture').run(page, { oraclePath: path.join(output, 'oracle.json'), projectPath })
			console.log(JSON.stringify({ status: 'PASS', test: 'v2-geometry-export', output, ...result }))
		}
		if (process.env.BLOCKBENCH_TEST_V2_ARTISTS === '1') {
			const { runArtist } = require('./v2-artist-fixture')
			const output = path.join(profileRoot, 'v2-artist-output')
			const namespace = process.env.IA_V2_NAMESPACE || 'test'
			const artists = [
				['goofy_goblin', process.env.IA_V2_GOBLIN_SOURCE || path.join(root, 'projects/native-v2/goofy_goblin/source/goofy_goblin.bbmodel'), {}],
				['armored_grub', process.env.IA_V2_GRUB_SOURCE || path.join(root, 'projects/native-v2/armored_grub/source/armored_grub.bbmodel'), {}],
				['ender_dragon_v2', process.env.IA_V2_DRAGON_SOURCE || path.join(root, 'projects/native-v2/ender_dragon_v2/source/ender_dragon_v2.bbmodel'), { entityType: 'ENDER_DRAGON', flightBlend: true, proceduralMotion: true }],
			].filter(([id]) => !process.env.IA_V2_ARTIST_IDS || process.env.IA_V2_ARTIST_IDS.split(',').includes(id))
			const results = []
			for (const [id, sourcePath, options] of artists) results.push(await runArtist(page, { sourcePath, id, namespace, outputRoot: path.join(output, id), ...options }))
			console.log(JSON.stringify({ status: 'PASS', test: 'v2-artist-exports', output, results }))
		}
		if (process.env.BLOCKBENCH_TEST_V2_PROCEDURAL_FIXTURES === '1') {
			const output = path.join(profileRoot, 'v2-procedural-fixtures')
			const sourcePath = process.env.IA_V2_DRAGON_SOURCE || path.join(root, 'projects/native-v2/ender_dragon_v2/source/ender_dragon_v2.bbmodel')
			const results = await require('./v2-procedural-fixtures').run(page, { sourcePath, outputRoot: output })
			console.log(JSON.stringify({ status: 'PASS', test: 'v2-procedural-fixtures', output, results }))
		}
			if (process.env.BLOCKBENCH_TEST_V2_PIG === '1') {
			const output = path.join(profileRoot, 'v2-pig-output')
			const result = await require('./v2-pig-parity').runPig(page, { outputRoot: output, namespace: process.env.IA_V2_NAMESPACE || 'test' })
				console.log(JSON.stringify({ status: 'PASS', test: 'v2-pig-export', ...result }))
			}
			if (process.env.BLOCKBENCH_TEST_V2_COMBINED === '1') {
				const { runArtist } = require('./v2-artist-fixture')
				const output = process.env.IA_V2_COMBINED_OUTPUT || path.join(profileRoot, 'v2-combined-output')
				const namespace = process.env.IA_V2_NAMESPACE || 'test'
				fs.rmSync(output, { recursive: true, force: true })
				await require('./v2-pig-parity').runPig(page, { outputRoot: output, namespace, preserveResourcepack: true })
				for (const [id, sourcePath] of [
					['goofy_goblin', process.env.IA_V2_GOBLIN_SOURCE], ['armored_grub', process.env.IA_V2_GRUB_SOURCE],
				]) await runArtist(page, { sourcePath, id, namespace, outputRoot: output, preserveResourcepack: true })
				console.log(JSON.stringify({ status: 'PASS', test: 'v2-combined-export', output }))
			}
		if (process.env.BLOCKBENCH_TEST_V2_ZOMBIE === '1') {
			const output = path.join(profileRoot, 'v2-zombie-output')
			const result = await require('./v2-zombie-parity').run(page, { output })
			console.log(JSON.stringify({ status: 'PASS', test: 'v2-zombie-export', ...result }))
		}
		if (process.env.BLOCKBENCH_TEST_V2_COMPOSITION === '1') {
			const output = path.join(profileRoot, 'v2-composition-output')
			const result = await require('./v2-composition-fixture').run(page, { output })
			console.log(JSON.stringify({ status: 'PASS', test: 'v2-composition-export', ...result }))
		}
		await page.waitForTimeout(0)
		if (editorErrors.length) throw new Error(`Unexpected editor errors:\n${editorErrors.join('\n')}`)
	} finally {
		await browser.close()
	}
}

main().catch((error) => {
	console.error(error.stack || error.message)
	process.exitCode = 1
}).finally(stop).catch(error => {
	console.error(error.stack || error.message)
	process.exitCode = 1
})
