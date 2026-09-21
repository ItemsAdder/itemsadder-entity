import assert from 'assert'
import crypto from 'crypto'
import { addV2EmbeddedTexture, beginV2EmbeddedTextures, v2EmbeddedTextureMeta, v2EmbeddedTextures } from './v2EmbeddedTextures'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const digest = crypto.createHash('sha256').update(png).digest('hex')
beginV2EmbeddedTextures(true)
assert.equal(addV2EmbeddedTexture(png)?.digest, digest)
assert.equal(addV2EmbeddedTexture(Buffer.from(png))?.digest, digest)
assert.deepEqual(v2EmbeddedTextures(), { [digest]: png.toString('base64') })
const meta = { animation: { interpolate: true, frametime: 2 } }
const animatedDigest = '8b996f021dff239dad43457a10711056dd60bb11cb986e2a0f4abf6f37f9b7c2'
assert.equal(addV2EmbeddedTexture(png, meta)?.digest, animatedDigest)
assert.notEqual(addV2EmbeddedTexture(png, { animation: { frametime: 3 } })?.digest, animatedDigest)
assert.deepEqual(v2EmbeddedTextureMeta()[animatedDigest], meta)
assert.throws(() => addV2EmbeddedTexture(Buffer.from('not png')))
beginV2EmbeddedTextures(false)
assert.equal(addV2EmbeddedTexture(png), undefined)
assert.deepEqual(v2EmbeddedTextures(), {})
assert.deepEqual(v2EmbeddedTextureMeta(), {})
