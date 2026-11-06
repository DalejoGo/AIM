import type { CheckId } from './idToken'
import type { ClientSession } from './pkce'
import type { Step } from './store'

// Visible text of the demo (DEC-010: Spanish, "tú", plain words; each term explained the first time).

export type ActorId = 'browser' | 'app' | 'server' | 'api'

/** Left to right, as in the diagram. */
export const ACTORS: ActorId[] = ['browser', 'app', 'server', 'api']

/** Short name for the diagram, plus the wording screen readers get instead of the arrows. */
export const actorNames: Record<ActorId, { short: string; subject: string; to: string }> = {
  browser: { short: 'Navegador', subject: 'Tu navegador', to: 'a tu navegador' },
  app: { short: 'Tu app', subject: 'Tu app', to: 'a tu app' },
  server: { short: 'Servidor', subject: 'El servidor de autorización', to: 'al servidor de autorización' },
  api: { short: 'API', subject: 'La API', to: 'a la API' },
}

/** A message as a sentence, e.g. "Tu app al servidor de autorización: envía el code…". */
export function describeMessage({ from, to, label }: Message): string {
  const action = `${label.charAt(0).toLowerCase()}${label.slice(1)}`
  const route =
    from === to
      ? `${actorNames[from].subject}, sin enviar nada`
      : `${actorNames[from].subject} ${actorNames[to].to}`
  return `${route}: ${action}.`
}

export interface Message {
  from: ActorId
  to: ActorId
  label: string
}

export interface StepCopy {
  /** For the progress list. */
  short: string
  title: string
  intro: string[]
  /** Who sends what in this step, in order. A message from an actor to itself is local work. */
  messages: Message[]
}

export const stepCopy: Record<Step, StepCopy> = {
  1: {
    short: 'Preparar',
    title: 'Tu app prepara la solicitud',
    intro: [
      'Antes de enviarte a iniciar sesión, tu app crea cuatro valores al azar con la criptografía de tu navegador y los guarda en tu sesión.',
      'Ninguno es una contraseña. Sirven para comprobar más adelante que cada respuesta pertenece a esta solicitud y no a una copiada o inventada por otra persona.',
    ],
    messages: [{ from: 'app', to: 'app', label: 'Crea el verifier, el challenge, el state y el nonce' }],
  },
  2: {
    short: 'Pedir permiso',
    title: 'Tu app te envía al servidor de autorización',
    intro: [
      'El servidor de autorización es el sistema que guarda tu cuenta, como el de Google, GitHub o Microsoft. Tu app arma una URL con lo que necesita y lleva a tu navegador hasta ella.',
      'Fíjate en que viaja el code_challenge y no el code_verifier. Aunque alguien lea esta URL en tu historial o en un registro, no le sirve para canjear el código que vendrá después.',
    ],
    messages: [
      { from: 'app', to: 'browser', label: 'Te redirige a la URL de autorización' },
      { from: 'browser', to: 'server', label: 'Pide permiso con el challenge y el state' },
    ],
  },
  3: {
    short: 'Iniciar sesión',
    title: 'Inicias sesión y das tu permiso',
    intro: [
      'Ahora estás en el sitio del servidor de autorización, no en tu app. Tu contraseña solo la ve ese servidor: tu app nunca la recibe.',
      'El servidor te muestra qué datos pide la app y tú decides. Si aceptas, crea para tu app un código de un solo uso.',
    ],
    messages: [
      { from: 'server', to: 'browser', label: 'Te pide iniciar sesión y dar permiso' },
      { from: 'browser', to: 'server', label: 'Envía que aceptas' },
    ],
  },
  4: {
    short: 'Volver a tu app',
    title: 'El servidor te devuelve a tu app con un código',
    intro: [
      'El servidor lleva a tu navegador de vuelta a la redirect_uri con un code (un código de un solo uso que caduca en segundos) y el mismo state que recibió.',
      'Tu app compara ese state con el que guardó en el paso 1. Si no coincide, descarta la respuesta: podría venir de un inicio de sesión que tú no empezaste.',
    ],
    messages: [
      { from: 'server', to: 'browser', label: 'Redirige con el code y el state' },
      { from: 'browser', to: 'app', label: 'Entrega el code y el state' },
    ],
  },
  5: {
    short: 'Canjear el código',
    title: 'Tu app canjea el código por tokens',
    intro: [
      'Tu app envía el code junto con el code_verifier directamente al servidor, sin pasar por tu navegador.',
      'El servidor calcula la huella SHA-256 del verifier y la compara con el code_challenge del paso 2. Si alguien robó el code en la redirección, no le sirve: le falta el verifier, que nunca pasó por tu navegador.',
    ],
    messages: [{ from: 'app', to: 'server', label: 'Envía el code y el verifier por un canal directo' }],
  },
  6: {
    short: 'Verificar tokens',
    title: 'Tu app verifica el id_token',
    intro: [
      'El servidor responde con un access_token, la llave para llamar a la API, y un id_token: un JWT (JSON Web Token, un texto firmado en tres partes) que dice quién eres.',
      'Tu app comprueba la firma con la llave pública del servidor y revisa el emisor, la audiencia, la vigencia y el nonce. Si alguien cambia una sola letra, la firma deja de coincidir.',
    ],
    messages: [
      { from: 'server', to: 'app', label: 'Responde con el access_token y el id_token' },
      { from: 'app', to: 'api', label: 'Llama a la API con el access_token' },
    ],
  },
}

export const sessionValues: { key: keyof ClientSession; name: string; hint: string }[] = [
  {
    key: 'codeVerifier',
    name: 'code_verifier',
    hint: 'Un secreto al azar que no sale de tu app hasta el paso 5. Es la base de PKCE (Proof Key for Code Exchange): la prueba de que quien canjea el código es quien lo pidió.',
  },
  {
    key: 'codeChallenge',
    name: 'code_challenge',
    hint: 'La huella SHA-256 del verifier, escrita en base64url (un formato de texto seguro para URLs). Una huella siempre da el mismo resultado y no permite reconstruir el original, así que puede viajar a la vista.',
  },
  {
    key: 'state',
    name: 'state',
    hint: 'Un valor único para esta solicitud. Si la respuesta no lo trae idéntico, tu app la descarta. Así te protege de CSRF: que alguien te haga completar un inicio de sesión que tú no pediste.',
  },
  {
    key: 'nonce',
    name: 'nonce',
    hint: 'Otro valor único, que el servidor debe copiar dentro del id_token. Así tu app sabe que el token se emitió para este inicio de sesión y no es uno reutilizado.',
  },
]

/** Why each parameter of the authorization URL is there. */
export const authorizationParams: Record<string, string> = {
  response_type: 'Pide un código de autorización (code) en lugar de tokens directos.',
  client_id: 'Identifica a tu app ante el servidor.',
  redirect_uri: 'A dónde debe volver el servidor. Tiene que ser idéntica a la que tu app registró.',
  scope: 'Lo que pides: saber quién eres (openid), tu perfil (profile) y tu correo (email).',
  state: 'El valor del paso 1 contra CSRF.',
  nonce: 'El valor del paso 1 que volverá dentro del id_token.',
  code_challenge: 'La huella del verifier. El verifier se queda en tu app.',
  code_challenge_method: 'Cómo se calculó la huella: S256 significa SHA-256.',
}

export const simulatedNote =
  'Servidor simulado: example.com es un dominio reservado para ejemplos. Esta demo no hace ninguna petición de red; todo ocurre en tu navegador.'

export interface Outcome {
  ok: boolean
  title: string
  detail: string
}

export const stateOutcome = {
  ok: {
    ok: true,
    title: 'Verificado',
    detail: 'El state coincide: la respuesta pertenece a la solicitud que hiciste.',
  },
  state_mismatch: {
    ok: false,
    title: 'Rechazado',
    detail: 'El state no coincide. Tu app descarta la respuesta y no canjea el code.',
  },
  state_missing: {
    ok: false,
    title: 'Rechazado',
    detail: 'La respuesta no trae state. Tu app la descarta y no canjea el code.',
  },
  invalid_response: {
    ok: false,
    title: 'Rechazado',
    detail: 'La respuesta no trae un code válido. Tu app la descarta.',
  },
} satisfies Record<string, Outcome>

export const pkceOutcome = {
  ok: {
    ok: true,
    title: 'Verificado',
    detail:
      'Las huellas coinciden: quien canjea el code es la app que empezó el flujo. El servidor entrega los tokens.',
  },
  mismatch: {
    ok: false,
    title: 'Rechazado con invalid_grant',
    detail: 'La huella no coincide con el code_challenge. Sin el verifier original, un code robado no sirve.',
  },
  malformed: {
    ok: false,
    title: 'Rechazado con invalid_request',
    detail:
      'Un code_verifier válido tiene entre 43 y 128 caracteres: letras sin tilde, números, guion, punto, guion bajo o virgulilla (~).',
  },
} satisfies Record<string, Outcome>

export const checkCopy: Record<CheckId, { label: string; name: string; ok: string; fail: string }> = {
  format: {
    label: 'Formato',
    name: 'formato',
    ok: 'Es un JWT legible.',
    fail: 'No es un JWT legible: el payload tiene que ser JSON válido.',
  },
  signature: {
    label: 'Firma ES256',
    name: 'firma',
    ok: 'Coincide con la llave pública del servidor.',
    fail: 'No coincide: el contenido cambió después de firmarse o lo firmó otra llave.',
  },
  issuer: {
    label: 'Emisor (iss)',
    name: 'emisor',
    ok: 'Lo emitió el servidor que esperabas.',
    fail: 'Lo emitió otro servidor.',
  },
  audience: {
    label: 'Audiencia (aud)',
    name: 'audiencia',
    ok: 'Está dirigido a tu app.',
    fail: 'Está dirigido a otra app.',
  },
  expiry: {
    label: 'Vigencia (exp)',
    name: 'vigencia',
    ok: 'Todavía no vence.',
    fail: 'Ya venció o no dice cuándo vence.',
  },
  nonce: {
    label: 'nonce',
    name: 'nonce',
    ok: 'Es el nonce que tu app guardó en el paso 1.',
    fail: 'No es el nonce del paso 1: el token pertenece a otro inicio de sesión.',
  },
}

const list = new Intl.ListFormat('es', { type: 'conjunction' })

export function idTokenOutcome(checks: { id: CheckId; ok: boolean }[]): Outcome {
  const failed = checks.filter((check) => !check.ok).map((check) => checkCopy[check.id].name)
  return failed.length === 0
    ? {
        ok: true,
        title: 'Verificado',
        detail: 'El id_token es auténtico y pertenece a este inicio de sesión: tu app ya sabe quién eres.',
      }
    : {
        ok: false,
        title: 'Rechazado',
        detail: `Falló la comprobación de ${list.format(failed)}. Tu app no inicia la sesión con este token.`,
      }
}

/** Why "Siguiente paso" does nothing right now, or what to do at the end. */
export const blockedHint: Partial<Record<Step, string>> = {
  1: 'Espera un momento: tu navegador está generando los valores.',
  3: 'Para seguir, pulsa Aceptar en la pantalla del servidor.',
  4: 'Para seguir, restaura el state original.',
  5: 'Para seguir, restaura el verifier original.',
  6: 'Llegaste al final. Pulsa Reiniciar para recorrerlo otra vez con valores nuevos.',
}
