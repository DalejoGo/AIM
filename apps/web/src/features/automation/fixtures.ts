import type { AutomationStepEvent } from '@aim/contracts'

/** One `step` event of each kind, as the API streams them (shared by this feature's tests). */
export const EVENTS = {
  received: { step: 'received', data: { execution: '1042' }, atMs: 120 },
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
    atMs: 260,
  },
  scored: {
    step: 'scored',
    data: { score: 75, tier: 'hot', factors: [{ label: 'Plazo urgente', points: 20 }] },
    atMs: 400,
  },
  routed: {
    step: 'routed',
    data: { route: 'call', label: 'Llamada', sla: 'Llamada en menos de 24 horas' },
    atMs: 520,
  },
  drafted: { step: 'drafted', data: { subject: 'Laura, hablemos', body: 'Hola Laura' }, atMs: 700 },
  recorded: { step: 'recorded', data: { reference: 'AIM-0B7C6A2E' }, atMs: 820 },
  done: { step: 'done', data: { outcome: 'accepted' }, atMs: 900 },
} as const satisfies { [S in AutomationStepEvent['step']]: Extract<AutomationStepEvent, { step: S }> }
