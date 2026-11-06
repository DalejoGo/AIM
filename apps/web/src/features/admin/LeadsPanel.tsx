import type { Lead, LeadStatus } from '@aim/contracts'
import { useSignal } from '@preact/signals'
import { RefreshCw } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'
import { ApiRequestError, api, isSessionExpired, messageForStatus } from '../../lib/api'
import { focusSoon, inputClass, Spinner } from '../forms/fields'
import { ScrollRegion } from '../migrator/ScrollTable'
import {
  type Catalog,
  countLabel,
  describeQuote,
  formatDateTime,
  mailLink,
  messagePreview,
  phoneLink,
  STATUS_LABELS,
  STATUS_ORDER,
  serviceLabel,
} from './format'
import { useWideScreen } from './useWideScreen'

export const PAGE_SIZE = 20

interface LeadsPanelProps {
  catalog: Catalog
  canWrite: boolean
  onSessionEnd: () => void
}

interface Status {
  tone: 'ok' | 'error'
  text: string
}

const errorText = (error: unknown) => (error instanceof ApiRequestError ? error.message : messageForStatus(0))
const anchorId = (lead: Lead) => `lead-${lead.id}`

/** Leads, newest first: filter by status, load more by cursor, change the status of each one. */
export function LeadsPanel({ catalog, canWrite, onSessionEnd }: LeadsPanelProps) {
  const filter = useSignal<LeadStatus | ''>('')
  const items = useSignal<Lead[]>([])
  const cursor = useSignal<string | null>(null)
  const loading = useSignal<'first' | 'more' | null>('first')
  const loadError = useSignal<string | null>(null)
  const status = useSignal<Status | null>(null)
  const wide = useWideScreen()
  // Only the latest list request and the latest change of each lead may write to the screen.
  const listRequest = useRef(0)
  const changeRequest = useRef<Record<string, number>>({})

  async function load(reset: boolean) {
    const request = ++listRequest.current
    loading.value = reset ? 'first' : 'more'
    loadError.value = null
    try {
      const page = await api.listLeads({
        status: filter.value || undefined,
        cursor: reset ? undefined : (cursor.value ?? undefined),
        limit: PAGE_SIZE,
      })
      if (request !== listRequest.current) return
      const first = page.items[0]
      items.value = reset ? page.items : [...items.value, ...page.items]
      cursor.value = page.nextCursor
      if (!reset && first) {
        status.value = {
          tone: 'ok',
          text: `Cargué ${countLabel(page.items.length, 'contacto', 'contactos')} más.`,
        }
        focusSoon(anchorId(first))
      }
    } catch (error) {
      if (request !== listRequest.current) return
      if (isSessionExpired(error)) return onSessionEnd()
      loadError.value = errorText(error)
    } finally {
      if (request === listRequest.current) loading.value = null
    }
  }

  useEffect(() => {
    load(true)
  }, [])

  function replace(id: string, lead: Lead) {
    items.value = items.value.map((item) => (item.id === id ? lead : item))
  }

  async function changeStatus(lead: Lead, next: LeadStatus) {
    if (next === lead.status) return
    const request = (changeRequest.current[lead.id] ?? 0) + 1
    changeRequest.current[lead.id] = request
    const latest = () => changeRequest.current[lead.id] === request
    replace(lead.id, { ...lead, status: next })
    status.value = null
    try {
      const saved = await api.updateLeadStatus(lead.id, next)
      if (!latest()) return
      replace(lead.id, saved)
      status.value = {
        tone: 'ok',
        text: `Guardé el estado de ${saved.name}: ${STATUS_LABELS[saved.status]}.`,
      }
    } catch (error) {
      if (!latest()) return
      replace(lead.id, lead)
      if (isSessionExpired(error)) return onSessionEnd()
      status.value = {
        tone: 'error',
        text: `No se guardó el estado de ${lead.name}. ${errorText(error)}`,
      }
    }
  }

  const list = items.value
  const filterLabel = filter.value ? STATUS_LABELS[filter.value].toLowerCase() : null

  return (
    <div class="grid min-w-0 gap-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="grid gap-1.5">
          <label for="lead-filter" class="font-semibold">
            Mostrar
          </label>
          <select
            id="lead-filter"
            value={filter.value}
            onChange={(e) => {
              filter.value = e.currentTarget.value as LeadStatus | ''
              status.value = null
              load(true)
            }}
            class={`${inputClass} w-auto`}
          >
            <option value="">Todos los estados</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="button" class="btn btn-quiet" onClick={() => load(true)}>
          <RefreshCw size={18} aria-hidden="true" />
          Actualizar la lista
        </button>
      </div>

      <p role="status" aria-live="polite" class="min-h-[1.6em] text-step--1">
        {loading.value === 'first' ? (
          <span class="text-muted">Cargando contactos…</span>
        ) : status.value ? (
          <span class={status.value.tone === 'error' ? 'text-danger' : 'text-text'}>{status.value.text}</span>
        ) : loadError.value === null ? (
          <span class="text-muted">
            {countLabel(list.length, 'contacto', 'contactos')}
            {filterLabel ? ` con estado ${filterLabel}` : ''}
            {cursor.value ? ' cargados; hay más' : ''}.
          </span>
        ) : null}
      </p>

      {loadError.value && (
        <div role="alert" class="grid gap-3 rounded-lg border border-danger p-4">
          <p>{loadError.value}</p>
          <div>
            <button type="button" class="btn btn-quiet" onClick={() => load(list.length === 0)}>
              Intentar de nuevo
            </button>
          </div>
        </div>
      )}

      {loading.value !== 'first' && list.length === 0 && !loadError.value && (
        <p class="rounded-xl border border-dashed border-line p-6 text-muted">
          {filterLabel ? `No hay contactos con estado ${filterLabel}.` : 'Todavía no llegan contactos.'}
        </p>
      )}

      {list.length > 0 &&
        (wide ? (
          <LeadTable leads={list} catalog={catalog} canWrite={canWrite} onChange={changeStatus} />
        ) : (
          <LeadCards leads={list} catalog={catalog} canWrite={canWrite} onChange={changeStatus} />
        ))}

      {cursor.value && (
        <div>
          <button
            type="button"
            class="btn btn-quiet aria-disabled:cursor-wait"
            aria-disabled={loading.value === 'more'}
            onClick={() => {
              if (loading.value === null) load(false)
            }}
          >
            {loading.value === 'more' && <Spinner />}
            {loading.value === 'more' ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </div>
  )
}

interface ViewProps {
  leads: Lead[]
  catalog: Catalog
  canWrite: boolean
  onChange: (lead: Lead, status: LeadStatus) => void
}

const th = 'border-b border-line px-3 py-2 align-bottom font-semibold'
const td = 'border-b border-line px-3 py-3 align-top'

function LeadTable({ leads, catalog, canWrite, onChange }: ViewProps) {
  return (
    <ScrollRegion labelledBy="leads-caption">
      <table class="w-full border-collapse text-left text-step--1">
        <caption id="leads-caption" class="sr-only">
          Contactos recibidos, del más reciente al más antiguo
        </caption>
        <thead>
          <tr>
            <th scope="col" class={th}>
              Fecha
            </th>
            <th scope="col" class={th}>
              Nombre
            </th>
            <th scope="col" class={`${th} min-w-48`}>
              Contacto
            </th>
            <th scope="col" class={th}>
              Servicio
            </th>
            <th scope="col" class={th}>
              Cotización
            </th>
            <th scope="col" class={`${th} min-w-56`}>
              Mensaje
            </th>
            <th scope="col" class={`${th} min-w-36`}>
              Estado
            </th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td class={`${td} whitespace-nowrap text-muted`}>
                <time dateTime={lead.createdAt}>{formatDateTime(lead.createdAt)}</time>
              </td>
              <th scope="row" id={anchorId(lead)} tabIndex={-1} class={`${td} font-semibold`}>
                {lead.name}
              </th>
              <td class={td}>
                <ContactLinks lead={lead} />
              </td>
              <td class={td}>{serviceLabel(catalog, lead.service)}</td>
              <td class={`${td} min-w-44`}>
                <QuoteSummary lead={lead} catalog={catalog} />
              </td>
              <td class={td}>
                <MessageText text={lead.message} />
              </td>
              <td class={td}>
                <StatusControl lead={lead} canWrite={canWrite} onChange={onChange} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  )
}

function LeadCards({ leads, catalog, canWrite, onChange }: ViewProps) {
  return (
    <ul aria-label="Contactos recibidos, del más reciente al más antiguo" class="grid gap-4">
      {leads.map((lead) => (
        <li key={lead.id}>
          <article
            aria-labelledby={anchorId(lead)}
            class="grid min-w-0 gap-4 rounded-xl border border-line bg-raised p-4 text-step--1"
          >
            <div class="grid gap-1">
              <h3
                id={anchorId(lead)}
                tabIndex={-1}
                class="text-step-0 font-semibold [overflow-wrap:anywhere]"
              >
                {lead.name}
              </h3>
              <time dateTime={lead.createdAt} class="text-muted">
                {formatDateTime(lead.createdAt)}
              </time>
            </div>
            <dl class="grid gap-3">
              <div>
                <dt class="text-muted">Contacto</dt>
                <dd>
                  <ContactLinks lead={lead} />
                </dd>
              </div>
              <div>
                <dt class="text-muted">Servicio</dt>
                <dd>{serviceLabel(catalog, lead.service)}</dd>
              </div>
              {lead.quote && (
                <div>
                  <dt class="text-muted">Cotización</dt>
                  <dd>
                    <QuoteSummary lead={lead} catalog={catalog} />
                  </dd>
                </div>
              )}
              <div>
                <dt class="text-muted">Mensaje</dt>
                <dd>
                  <MessageText text={lead.message} />
                </dd>
              </div>
            </dl>
            <StatusControl lead={lead} canWrite={canWrite} onChange={onChange} labelled />
          </article>
        </li>
      ))}
    </ul>
  )
}

function ContactLinks({ lead }: { lead: Lead }) {
  const wa = lead.phone ? phoneLink(lead.phone) : null
  return (
    <ul class="grid gap-1">
      {lead.email && (
        <li>
          <a href={mailLink(lead.email)} class="link [overflow-wrap:anywhere]">
            {lead.email}
          </a>
        </li>
      )}
      {lead.phone && (
        <li>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" class="link whitespace-nowrap">
              +{lead.phone}
              <span class="sr-only"> en WhatsApp (se abre en otra pestaña)</span>
            </a>
          ) : (
            lead.phone
          )}
        </li>
      )}
    </ul>
  )
}

function QuoteSummary({ lead, catalog }: { lead: Lead; catalog: Catalog }) {
  if (!lead.quote) return <span class="text-muted">Sin cotización</span>
  const quote = describeQuote(lead.quote, catalog)
  return (
    <div class="grid gap-0.5">
      <span class="font-semibold">{quote.range}</span>
      <span>{quote.timeline}</span>
      <span class="text-muted">
        {quote.options.length > 0 ? quote.options.join(', ') : 'Sin adicionales'}
      </span>
    </div>
  )
}

/** Short messages show whole; long ones open on demand. */
function MessageText({ text }: { text: string }) {
  const preview = messagePreview(text)
  const full = <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
  if (preview === null) return full
  return (
    <details class="group">
      <summary class="cursor-pointer [overflow-wrap:anywhere]">
        <span class="group-open:hidden">{preview} </span>
        <span class="link whitespace-nowrap">
          <span class="group-open:hidden">Ver mensaje completo</span>
          <span class="hidden group-open:inline">Ocultar mensaje</span>
        </span>
      </summary>
      <div class="mt-2">{full}</div>
    </details>
  )
}

interface StatusControlProps {
  lead: Lead
  canWrite: boolean
  onChange: (lead: Lead, status: LeadStatus) => void
  /** Cards show a visible label; the table relies on the column header. */
  labelled?: boolean
}

function StatusControl({ lead, canWrite, onChange, labelled = false }: StatusControlProps) {
  const id = `status-${lead.id}`
  if (!canWrite) return <span>{STATUS_LABELS[lead.status]}</span>
  const select = (
    <select
      id={id}
      aria-label={`Estado de ${lead.name}`}
      value={lead.status}
      onChange={(e) => onChange(lead, e.currentTarget.value as LeadStatus)}
      class={`${inputClass} py-2`}
    >
      {STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  )
  if (!labelled) return select
  return (
    <div class="grid gap-1.5">
      <label for={id} class="font-semibold">
        Estado
      </label>
      {select}
    </div>
  )
}
