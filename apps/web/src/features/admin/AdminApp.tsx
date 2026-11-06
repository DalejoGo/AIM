import type { Principal } from '@aim/contracts'
import { useSignal } from '@preact/signals'
import { LogOut } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'
import { ApiRequestError, api, isSessionExpired, messageForStatus } from '../../lib/api'
import { Spinner } from '../forms/fields'
import { AuditPanel } from './AuditPanel'
import type { Catalog } from './format'
import { LeadsPanel } from './LeadsPanel'
import { Login, type Notice } from './Login'

export interface AdminAppProps {
  turnstileSiteKey: string
  catalog: Catalog
}

type Session =
  | { kind: 'checking' }
  | { kind: 'signed-out'; notice: Notice | null }
  | { kind: 'signed-in'; principal: Principal; fromLogin: boolean }

const SESSION_ENDED: Notice = { tone: 'info', text: 'Tu sesión terminó. Vuelve a entrar con tu correo.' }

/** /admin/ (DEC-017): checks the session on load, then shows the login or the panel. */
export default function AdminApp({ turnstileSiteKey, catalog }: AdminAppProps) {
  const session = useSignal<Session>({ kind: 'checking' })

  useEffect(() => {
    api
      .me()
      .then((principal) => {
        session.value = { kind: 'signed-in', principal, fromLogin: false }
      })
      .catch((error: unknown) => {
        // No session yet is the normal first visit: the login shows without a message.
        session.value = {
          kind: 'signed-out',
          notice: isSessionExpired(error)
            ? null
            : {
                tone: 'error',
                text: `No pude comprobar si ya tienes una sesión. ${error instanceof ApiRequestError ? error.message : messageForStatus(0)}`,
              },
        }
      })
  }, [])

  const current = session.value
  if (current.kind === 'checking') {
    return (
      <p role="status" class="flex items-center gap-2 text-muted">
        <Spinner />
        Comprobando tu sesión…
      </p>
    )
  }
  if (current.kind === 'signed-out') {
    return (
      <Login
        turnstileSiteKey={turnstileSiteKey}
        notice={current.notice}
        onSignedIn={(principal) => {
          session.value = { kind: 'signed-in', principal, fromLogin: true }
        }}
      />
    )
  }
  return (
    <Dashboard
      principal={current.principal}
      catalog={catalog}
      focusTabs={current.fromLogin}
      onSignedOut={(notice) => {
        session.value = { kind: 'signed-out', notice }
      }}
    />
  )
}

type TabId = 'leads' | 'audit'

interface DashboardProps {
  principal: Principal
  catalog: Catalog
  /** After signing in, the focus moves from the (gone) login form to the first tab. */
  focusTabs: boolean
  onSignedOut: (notice: Notice) => void
}

function Dashboard({ principal, catalog, focusTabs, onSignedOut }: DashboardProps) {
  const tabs: { id: TabId; label: string }[] = [
    ...(principal.scope.includes('leads:read') ? [{ id: 'leads' as const, label: 'Contactos' }] : []),
    ...(principal.scope.includes('audit:read') ? [{ id: 'audit' as const, label: 'Accesos' }] : []),
  ]
  const active = useSignal<TabId | null>(tabs[0]?.id ?? null)
  // The audit log loads the first time its tab opens, then stays mounted.
  const opened = useSignal<TabId[]>(tabs[0] ? [tabs[0].id] : [])
  const signingOut = useSignal(false)
  const signOutError = useSignal<string | null>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (focusTabs) buttons.current[0]?.focus()
  }, [])

  function select(id: TabId) {
    active.value = id
    if (!opened.value.includes(id)) opened.value = [...opened.value, id]
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: -1 }
    const move = moves[event.key]
    if (move === undefined) return
    event.preventDefault()
    const next = (move + tabs.length) % tabs.length
    const tab = tabs[next]
    if (tab) select(tab.id)
    buttons.current[next]?.focus()
  }

  async function signOut() {
    if (signingOut.value) return
    signingOut.value = true
    signOutError.value = null
    try {
      await api.signOut()
      onSignedOut({ tone: 'info', text: 'Cerraste la sesión.' })
    } catch (error) {
      if (isSessionExpired(error)) return onSignedOut(SESSION_ENDED)
      signOutError.value = `No se cerró la sesión. ${error instanceof ApiRequestError ? error.message : messageForStatus(0)}`
    } finally {
      signingOut.value = false
    }
  }

  const endSession = () => onSignedOut(SESSION_ENDED)

  return (
    <div class="grid min-w-0 gap-8">
      <div class="grid gap-3 border-b border-line pb-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <p class="min-w-0 text-step--1 text-muted">
            Entraste como{' '}
            <span class="font-semibold text-text [overflow-wrap:anywhere]">{principal.sub}</span>
          </p>
          <button
            type="button"
            class="btn btn-quiet aria-disabled:cursor-wait"
            aria-disabled={signingOut.value}
            onClick={signOut}
          >
            {signingOut.value ? <Spinner /> : <LogOut size={18} aria-hidden="true" />}
            Cerrar sesión
          </button>
        </div>
        <div role="alert">
          {signOutError.value && <p class="rounded-lg border border-danger p-3">{signOutError.value}</p>}
        </div>
      </div>

      {tabs.length === 0 ? (
        <p class="rounded-xl border border-dashed border-line p-6 text-muted">
          Tu cuenta no tiene permisos para ver contactos ni accesos.
        </p>
      ) : (
        <div class="grid min-w-0 gap-6">
          <div
            role="tablist"
            aria-label="Secciones del panel"
            class="flex flex-wrap gap-x-2 border-b border-line"
          >
            {tabs.map((tab, index) => {
              const selected = active.value === tab.id
              return (
                <button
                  key={tab.id}
                  ref={(element) => {
                    buttons.current[index] = element
                  }}
                  type="button"
                  role="tab"
                  id={`admin-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`admin-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  class={`-mb-px border-b-2 px-3 py-2 text-step-1 font-semibold transition-colors ${
                    selected ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'
                  }`}
                  onClick={() => select(tab.id)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tabpanel"
              id={`admin-panel-${tab.id}`}
              aria-labelledby={`admin-tab-${tab.id}`}
              hidden={active.value !== tab.id}
              class="min-w-0"
            >
              {opened.value.includes(tab.id) &&
                (tab.id === 'leads' ? (
                  <LeadsPanel
                    catalog={catalog}
                    canWrite={principal.scope.includes('leads:write')}
                    onSessionEnd={endSession}
                  />
                ) : (
                  <AuditPanel onSessionEnd={endSession} />
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
