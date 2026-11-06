import { LockKeyhole } from 'lucide-preact'
import { demo } from './authorization'
import {
  authorizationParams,
  checkCopy,
  idTokenOutcome,
  pkceOutcome,
  sessionValues,
  simulatedNote,
  stateOutcome,
} from './copy'
import { readSegment } from './jwt'
import { demoUser } from './server'
import type { AuthLabStore } from './store'
import {
  Code,
  Panel,
  QuietButton,
  StatusIcon,
  TamperActions,
  ValueInput,
  ValueRow,
  ValueTextarea,
  Verdict,
} from './ui'

interface StepProps {
  lab: AuthLabStore
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

/** Step 1: the four values the app keeps in your session. */
export function StepPrepare({ lab }: StepProps) {
  const session = lab.session.value
  return (
    <Panel title="Lo que tu app guarda en tu sesión">
      {session ? (
        <dl class="grid gap-6">
          {sessionValues.map(({ key, name, hint }) => (
            <ValueRow key={key} name={name} value={session[key]} hint={hint} />
          ))}
        </dl>
      ) : (
        <p class="text-muted">Generando valores con la criptografía de tu navegador…</p>
      )}
      <div>
        <QuietButton onClick={() => void lab.regenerate()}>Generar valores nuevos</QuietButton>
      </div>
    </Panel>
  )
}

/** Step 2: the authorization URL, whole and taken apart. */
export function StepAuthorize({ lab }: StepProps) {
  const url = lab.authorizationUrl.value
  if (!url) return null
  return (
    <Panel title="La URL a la que tu app lleva a tu navegador">
      <Code>{url.href}</Code>
      <dl class="grid gap-6">
        {[...url.searchParams].map(([name, value]) => (
          <ValueRow key={name} name={name} value={value} hint={authorizationParams[name]} />
        ))}
      </dl>
      <p class="text-step--1 text-muted">{simulatedNote}</p>
    </Panel>
  )
}

/** Step 3: the server's own page. No password field on purpose: the account is made up. */
export function StepConsent({ lab }: StepProps) {
  const accepted = lab.grant.value !== null
  return (
    <section
      aria-labelledby="auth-lab-consent-title"
      class="min-w-0 overflow-hidden rounded-xl border border-line bg-raised"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-ink px-4 py-2 text-step--1">
        <LockKeyhole aria-hidden="true" class="size-4 shrink-0 text-muted" />
        <span class="min-w-0 font-mono break-all">auth.example.com/authorize</span>
        <span class="text-muted sm:ml-auto">Pantalla simulada</span>
      </div>
      <div class="grid gap-4 p-4 sm:p-6">
        <h3 id="auth-lab-consent-title" class="text-step-1 font-semibold">
          Servidor de autorización de ejemplo
        </h3>
        <p>
          Ya iniciaste sesión como <strong>{demoUser.name}</strong> (
          <span class="font-mono break-all">{demoUser.email}</span>), una cuenta ficticia. En un servidor
          real, aquí escribirías tu contraseña: solo él la ve.
        </p>
        <div class="grid gap-2">
          <p>
            <strong>{demo.clientName}</strong> quiere:
          </p>
          <ul class="grid list-disc gap-1 pl-6">
            <li>Saber quién eres (openid).</li>
            <li>Ver tu nombre (profile).</li>
            <li>Ver tu correo (email).</li>
          </ul>
        </div>
        {accepted ? (
          <p class="flex items-start gap-3">
            <StatusIcon ok />
            <span>Ya diste tu permiso. El servidor creó un code y te devolvió a tu app.</span>
          </p>
        ) : (
          <div>
            <button type="button" class="btn btn-primary" onClick={() => void lab.approve()}>
              Aceptar
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

/** Step 4: the redirect back, and the state comparison you can break. */
export function StepCallback({ lab }: StepProps) {
  const session = lab.session.value
  const callback = lab.callbackUrl.value
  const check = lab.stateCheck.value
  if (!session || !callback || !check) return null
  return (
    <Panel title="La redirección que recibe tu app">
      <Code>{callback.href}</Code>
      <dl class="grid gap-6">
        <ValueRow name="state que tu app guardó en el paso 1" value={session.state} />
      </dl>
      <ValueInput
        id="auth-lab-state"
        label="state que llegó en la redirección"
        hint="Puedes editarlo. Altéralo, como haría alguien que intenta colarte una respuesta preparada por él, y mira qué hace tu app."
        value={lab.receivedState.value}
        onInput={lab.setReceivedState}
      />
      <TamperActions>
        <QuietButton onClick={lab.tamperState}>Alterar el state</QuietButton>
        <QuietButton onClick={lab.restoreState}>Restaurar el original</QuietButton>
      </TamperActions>
      <Verdict outcome={check.ok ? stateOutcome.ok : stateOutcome[check.reason]} />
    </Panel>
  )
}

/** Step 5: the back-channel request and the server's PKCE check, which you can break too. */
export function StepExchange({ lab }: StepProps) {
  const grant = lab.grant.value
  const pkce = lab.pkce.value
  if (!grant) return null
  return (
    <div class="grid gap-6">
      <Panel title="La solicitud de tu app al servidor">
        <Code>POST {demo.tokenEndpoint}</Code>
        <dl class="grid gap-6">
          <ValueRow name="grant_type" value="authorization_code" />
          <ValueRow name="code" value={grant.code} hint="El code que llegó en el paso 4." />
          <ValueRow name="redirect_uri" value={demo.redirectUri} />
          <ValueRow name="client_id" value={demo.clientId} />
        </dl>
        <ValueInput
          id="auth-lab-verifier"
          label="code_verifier"
          hint="El secreto del paso 1, que viaja por primera vez. Puedes editarlo para ver qué pasa si quien envía el code no lo tiene."
          value={lab.sentVerifier.value}
          onInput={(value) => void lab.setVerifier(value)}
        />
        <TamperActions>
          <QuietButton onClick={() => void lab.tamperVerifier()}>Usar un verifier inventado</QuietButton>
          <QuietButton onClick={() => void lab.restoreVerifier()}>Restaurar el original</QuietButton>
        </TamperActions>
      </Panel>

      <Panel title="Lo que comprueba el servidor">
        <dl class="grid gap-6">
          <ValueRow
            name="Huella SHA-256 del verifier recibido, en base64url"
            value={pkce?.computed ?? 'Calculando…'}
          />
          <ValueRow name="code_challenge que recibió en el paso 2" value={grant.request.codeChallenge} />
        </dl>
        <Verdict
          outcome={pkce ? (pkce.ok ? pkceOutcome.ok : pkceOutcome[pkce.reason]) : null}
          pending="Calculando la huella…"
        />
      </Panel>
    </div>
  )
}

/** Step 6: the token response, the id_token taken apart, and the app's checks on it. */
export function StepTokens({ lab }: StepProps) {
  const tokens = lab.tokens.value
  const key = lab.signingKey.value
  const session = lab.session.value
  const verdict = lab.verdict.value
  if (!tokens || !key || !session) return null
  const [header = '', payload = '', signature = ''] = lab.idToken.value.split('.')
  const receivedNonce = lab.decodedIdToken.value?.payload.nonce

  return (
    <div class="grid gap-6">
      <Panel title="La respuesta del servidor">
        <dl class="grid gap-6">
          <ValueRow
            name="access_token"
            value={tokens.access_token}
            hint="La llave para llamar a la API. Tu app no necesita entenderla: solo la envía."
          />
          <ValueRow name="token_type" value={tokens.token_type} />
          <ValueRow
            name="expires_in"
            value={tokens.expires_in}
            hint="Segundos que dura el access_token: una hora."
          />
        </dl>
      </Panel>

      <Panel title="El id_token, en sus tres partes">
        <Code>
          <span class="text-brand">{header}</span>.<span>{payload}</span>.
          <span class="text-muted">{signature}</span>
        </Code>
        <ul class="grid gap-2 text-step--1">
          <li class="flex items-start gap-2">
            <span aria-hidden="true" class="mt-1.5 size-3 shrink-0 rounded-sm bg-brand" />
            <span>
              <strong class="font-semibold">Header:</strong> cómo se firmó.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <span aria-hidden="true" class="mt-1.5 size-3 shrink-0 rounded-sm bg-text" />
            <span>
              <strong class="font-semibold">Payload:</strong> los datos (claims) sobre ti y sobre el token.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <span aria-hidden="true" class="mt-1.5 size-3 shrink-0 rounded-sm bg-muted" />
            <span>
              <strong class="font-semibold">Firma:</strong> protege a los dos anteriores.
            </span>
          </li>
        </ul>
        <dl class="grid gap-6">
          <ValueRow name="Header decodificado" value={pretty(readSegment(header))} multiline />
          <ValueRow
            name="Firma"
            value={signature}
            hint="ES256: firma ECDSA con la curva P-256 y SHA-256. El par de llaves se creó en tu navegador al abrir la demo; la llave privada no se puede exportar y se descarta al reiniciar."
          />
        </dl>
        <ValueTextarea
          id="auth-lab-payload"
          label="Payload decodificado"
          hint="Puedes editarlo: cambia cualquier dato y mira cómo responde la verificación."
          value={lab.payloadText.value}
          onInput={(text) => void lab.editPayload(text)}
        />
      </Panel>

      <Panel title="Lo que comprueba tu app">
        <TamperActions>
          <QuietButton onClick={() => void lab.tamperEmail()}>
            Cambiar el correo por el de un administrador
          </QuietButton>
          <QuietButton onClick={() => void lab.replayForeignToken()}>
            Usar un token de otro inicio de sesión
          </QuietButton>
          <QuietButton onClick={() => void lab.restoreIdToken()}>Restaurar el token original</QuietButton>
        </TamperActions>
        <Verdict outcome={verdict ? idTokenOutcome(verdict.checks) : null} pending="Verificando…" />
        {verdict && (
          <ul class="grid gap-3" aria-label="Comprobaciones">
            {verdict.checks.map((check) => (
              <li key={check.id} class="flex items-start gap-3">
                <StatusIcon ok={check.ok} />
                <span>
                  <strong class="font-semibold">{checkCopy[check.id].label}.</strong>{' '}
                  {check.ok ? checkCopy[check.id].ok : checkCopy[check.id].fail}
                </span>
              </li>
            ))}
          </ul>
        )}
        <dl class="grid gap-6">
          <ValueRow name="nonce que tu app guardó en el paso 1" value={session.nonce} />
          <ValueRow
            name="nonce que trae el token"
            value={typeof receivedNonce === 'string' ? receivedNonce : 'Ninguno'}
          />
          <ValueRow
            name="Llave pública del servidor (JWK)"
            value={pretty(key.publicJwk)}
            multiline
            hint="Tu app la descarga del servidor (en la vida real, de su dirección JWKS). Con ella comprueba la firma, pero no puede firmar."
          />
        </dl>
      </Panel>

      <Panel title="Y ahora, la API">
        <p>
          Con el id_token verificado, tu app ya sabe quién eres. Para pedirle datos a la API, envía el
          access_token en cada llamada:
        </p>
        <Code>Authorization: Bearer {tokens.access_token}</Code>
      </Panel>
    </div>
  )
}
