import { decodeBase64url, decodeText, encodeBase64url, encodeText } from './base64url'

export type JsonObject = Record<string, unknown>

export interface DecodedJwt {
  header: JsonObject
  payload: JsonObject
  /** The three base64url segments as they appear in the token. */
  parts: [header: string, payload: string, signature: string]
}

/** ES256 (RFC 7518, section 3.4): ECDSA on P-256 with SHA-256. WebCrypto already emits the raw r||s form JWS uses. */
const ES256 = { name: 'ECDSA', hash: 'SHA-256' } as const

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSegment(segment: string): JsonObject {
  const value: unknown = JSON.parse(decodeText(segment))
  if (!isObject(value)) throw new TypeError('JWT segment is not a JSON object')
  return value
}

/** One segment as a JSON object, or null when it is not one. For display only: it proves nothing. */
export function readSegment(segment: string): JsonObject | null {
  try {
    return parseSegment(segment)
  } catch {
    return null
  }
}

/** Reads a compact JWS without trusting it. Throws when it is not three base64url segments of JSON objects. */
export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.')
  if (parts.length !== 3) throw new TypeError('A JWT has exactly three segments')
  const [header, payload, signature] = parts as [string, string, string]
  decodeBase64url(signature)
  return { header: parseSegment(header), payload: parseSegment(payload), parts: [header, payload, signature] }
}

export async function signJwt(
  header: JsonObject,
  payload: JsonObject,
  privateKey: CryptoKey,
): Promise<string> {
  const input = `${encodeText(JSON.stringify(header))}.${encodeText(JSON.stringify(payload))}`
  const signature = await crypto.subtle.sign(ES256, privateKey, new TextEncoder().encode(input))
  return `${input}.${encodeBase64url(new Uint8Array(signature))}`
}

/**
 * True only for a well-formed ES256 token whose signature matches header and payload exactly.
 * The algorithm is pinned: a token announcing "none" or anything else is refused instead of trusted.
 */
export async function verifyJwtSignature(token: string, publicKey: CryptoKey): Promise<boolean> {
  try {
    const { header, parts } = decodeJwt(token)
    if (header.alg !== 'ES256') return false
    const signature = decodeBase64url(parts[2])
    if (signature.byteLength !== 64) return false
    const input = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    return await crypto.subtle.verify(ES256, publicKey, signature, input)
  } catch {
    return false
  }
}

/** What an attacker can do without the private key: swap the payload and keep the old header and signature. */
export function withPayload(token: string, payloadJson: string): string {
  const [header = '', , signature = ''] = token.split('.')
  return `${header}.${encodeText(payloadJson)}.${signature}`
}
