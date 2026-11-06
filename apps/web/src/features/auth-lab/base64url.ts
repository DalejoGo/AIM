// base64url without padding (RFC 4648, section 5): the text encoding PKCE and JWTs use.
const ALPHABET = /^[A-Za-z0-9_-]*$/

export function encodeBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decodes unpadded base64url. Rejects foreign characters and non-canonical input (unused trailing bits set),
 * so two different strings can never stand for the same bytes, which matters for JWT signatures.
 */
export function decodeBase64url(input: string): Uint8Array<ArrayBuffer> {
  if (!ALPHABET.test(input) || input.length % 4 === 1) throw new TypeError('Invalid base64url input')
  const base64 = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(input.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (encodeBase64url(bytes) !== input) throw new TypeError('Non-canonical base64url input')
  return bytes
}

export function encodeText(text: string): string {
  return encodeBase64url(new TextEncoder().encode(text))
}

/** Decodes base64url into UTF-8 text; throws when the bytes are not valid UTF-8. */
export function decodeText(input: string): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64url(input))
}

/** Random bytes from the platform CSPRNG, as base64url. */
export function randomBase64url(byteLength = 32): string {
  return encodeBase64url(crypto.getRandomValues(new Uint8Array(byteLength)))
}
