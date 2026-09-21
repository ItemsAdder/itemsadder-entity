import crypto from 'crypto'
import { canonicalJson } from './EntityV2Codec'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
let enabled = false
const textures = new Map<string, string>()
const textureMeta = new Map<string, Record<string, unknown>>()

export function beginV2EmbeddedTextures(active: boolean): void {
	enabled = active
	textures.clear()
	textureMeta.clear()
}

export function addV2EmbeddedTexture(bytes: Buffer, meta?: Record<string, unknown>): { digest: string; base64: string } | undefined {
	if (!enabled) return undefined
	if (bytes.length < 24 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
		|| bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('V2 texture is not a PNG')
	const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
	if (!width || !height || width > 16384 || height > 16384 || width * height > 16_777_216) throw new Error('V2 texture dimensions are out of bounds')
	const hash = crypto.createHash('sha256').update(bytes)
	if (meta) hash.update(Buffer.from([0])).update(canonicalJson(meta))
	const digest = hash.digest('hex')
	const base64 = bytes.toString('base64')
	if (!textures.has(digest) && textures.size >= 256) throw new Error('Too many V2 textures')
	if (!textures.has(digest) && Array.from(textures.values()).reduce((sum, value) => sum + value.length, base64.length) > 16 * 1024 * 1024) throw new Error('V2 embedded textures are too large')
	textures.set(digest, base64)
	if (meta) textureMeta.set(digest, meta)
	return { digest, base64 }
}

export function v2EmbeddedTextures(): Record<string, string> {
	return Object.fromEntries(Array.from(textures).sort(([left], [right]) => left.localeCompare(right)))
}

export function v2EmbeddedTextureMeta(): Record<string, Record<string, unknown>> {
	return Object.fromEntries(Array.from(textureMeta).sort(([left], [right]) => left.localeCompare(right)))
}
