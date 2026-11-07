import type { AutomationStepEvent } from '@aim/contracts'

/** The name of the n8n workflow, as the API reports it in the `received` step. */
export const FLOW_NAME = 'Contacto → lead calificado'

/**
 * One `step` event of each kind, as the API streams them (shared by this feature's tests). The flow runs in
 * under a millisecond, so most times are 0.
 */
export const EVENTS = {
  received: { step: 'received', data: { flow: FLOW_NAME }, atMs: 0 },
  validated: {
    step: 'validated',
    data: {
      valid: true,
      checks: [
        { id: 'corporate_email', label: 'Correo corporativo', ok: true },
        { id: 'links', label: 'Sin enlaces sospechosos', ok: true },
        { id: 'detail', label: 'Mensaje con detalle', ok: false },
      ],
    },
    atMs: 0,
  },
  scored: {
    step: 'scored',
    data: { score: 75, tier: 'hot', factors: [{ label: 'Plazo urgente', points: 20 }] },
    atMs: 0,
  },
  routed: {
    step: 'routed',
    data: { route: 'call', label: 'Llamada', sla: 'Llamada en menos de 24 horas' },
    atMs: 0,
  },
  drafted: { step: 'drafted', data: { subject: 'Laura, hablemos', body: 'Hola Laura' }, atMs: 1 },
  recorded: { step: 'recorded', data: { reference: 'AIM-0B7C6A2E' }, atMs: 1 },
  done: { step: 'done', data: { outcome: 'accepted' }, atMs: 1 },
} as const satisfies { [S in AutomationStepEvent['step']]: Extract<AutomationStepEvent, { step: S }> }
