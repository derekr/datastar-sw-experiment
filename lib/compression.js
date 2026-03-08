import { MAX_DECOMPRESS_BYTES } from './constants.js'

export function mergeChunks(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { merged.set(c, offset); offset += c.length }
  return merged
}

// Uint8Array → base64url (chunked to avoid call stack overflow)
export function uint8ToBase64url(buf) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function compressToBase64url(jsonStr) {
  const buf = new TextEncoder().encode(jsonStr)
  if (typeof CompressionStream === 'undefined') {
    const { deflateSync } = await import('node:zlib')
    const compressed = deflateSync(Buffer.from(buf))
    return uint8ToBase64url(new Uint8Array(compressed))
  }
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  writer.write(buf)
  writer.close()
  const chunks = []
  const reader = cs.readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return uint8ToBase64url(mergeChunks(chunks))
}

export async function decompressFromBase64url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - b64url.length % 4) % 4)
  const bin = atob(b64)
  const buf = Uint8Array.from(bin, c => c.charCodeAt(0))
  if (typeof DecompressionStream === 'undefined') {
    const { inflateSync } = await import('node:zlib')
    const decompressed = inflateSync(Buffer.from(buf))
    if (decompressed.length > MAX_DECOMPRESS_BYTES) {
      throw new Error('Decompressed data exceeds size limit')
    }
    return new TextDecoder().decode(new Uint8Array(decompressed))
  }
  const ds = new DecompressionStream('deflate')
  const writer = ds.writable.getWriter()
  writer.write(buf)
  writer.close()
  const chunks = []
  let totalBytes = 0
  const reader = ds.readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.length
    if (totalBytes > MAX_DECOMPRESS_BYTES) {
      throw new Error('Decompressed data exceeds size limit')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(mergeChunks(chunks))
}
