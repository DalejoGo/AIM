// Cheap primitives only: the free Workers plan allows ~10 ms of CPU per request (DEC-014).

const encoder = new TextEncoder()

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A random opaque token with `bytes` of entropy, base64url-encoded. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** A uniformly random numeric code (rejection sampling avoids modulo bias). */
export function randomDigits(length = 6): string {
  const max = 10 ** length
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    const value = buffer[0] ?? 0
    if (value < limit) return String(value % max).padStart(length, '0')
  }
}

const keys = new Map<string, Promise<CryptoKey>>()

function hmacKey(secret: string, purpose: string): Promise<CryptoKey> {
  const id = `${purpose}:${secret}`
  let key = keys.get(id)
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      encoder.encode(`${purpose}|${secret}`),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    keys.set(id, key)
  }
  return key
}

/**
 * HMAC-SHA-256 of `value`, domain-separated by `purpose` so a code hash can never be replayed as a token hash.
 * Used to store login codes, refresh tokens and IPs without keeping them in clear.
 */
export async function hmac(secret: string, purpose: string, value: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret, purpose), encoder.encode(value))
  return base64url(new Uint8Array(signature))
}

const derived = new Map<string, Promise<Uint8Array>>()

/**
 * A 256-bit key for one `purpose`, derived from `secret` with HKDF-SHA-256 (RFC 5869). A token signed with the
 * key of one purpose never verifies with another, nor with the secret itself.
 */
export function deriveKey(secret: string, purpose: string): Promise<Uint8Array> {
  const id = `${purpose}:${secret}`
  let key = derived.get(id)
  if (!key) {
    key = (async () => {
      const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
        'deriveBits',
      ])
      const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(purpose) },
        material,
        256,
      )
      return new Uint8Array(bits)
    })()
    derived.set(id, key)
  }
  return key
}

/** Constant-time comparison of two strings of possibly different length. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}
