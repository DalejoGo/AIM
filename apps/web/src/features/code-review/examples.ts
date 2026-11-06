import type { Language } from './code'

/** A fragment with real bugs that the visitor can load with one click to see what a review finds. */
export interface CodeExample {
  id: string
  language: Language
  /** The language, as the button shows it. */
  title: string
  /** What is wrong with it, in a few words. */
  description: string
  code: string
}

const lines = (...rows: string[]) => rows.join('\n')

export const EXAMPLES: readonly CodeExample[] = [
  {
    id: 'typescript-sql',
    language: 'typescript',
    title: 'TypeScript',
    description: 'Una consulta SQL armada con el texto del visitante',
    code: lines(
      "import type { Request, Response } from 'express'",
      "import { pool } from './db'",
      '',
      '// Busca un usuario por correo para el panel de soporte.',
      'export async function findUserByEmail(req: Request, res: Response) {',
      '  const email = String(req.query.email)',
      `  const sql = "SELECT id, name, role FROM users WHERE email = '" + email + "'"`,
      '  const result = await pool.query(sql)',
      '  res.json(result.rows[0])',
      '}',
    ),
  },
  {
    id: 'python-except',
    language: 'python',
    title: 'Python',
    description: 'Un except que se traga los errores y una división por cero',
    code: lines(
      '# Calcula el valor promedio de los pedidos de un cliente.',
      'def average_order_value(orders):',
      '    total = 0',
      '    for order in orders:',
      '        try:',
      '            total += float(order["amount"])',
      '        except Exception:',
      '            pass',
      '    return total / len(orders)',
    ),
  },
  {
    id: 'javascript-foreach',
    language: 'javascript',
    title: 'JavaScript',
    description: 'Un await dentro de forEach y una comparación con ==',
    code: lines(
      '// Envía un recordatorio a cada usuario con pagos pendientes y devuelve cuántos se enviaron.',
      'async function sendPaymentReminders(users, mailer) {',
      '  let sent = 0',
      '  users.forEach(async (user) => {',
      '    if (user.pendingPayments == 0) return',
      "    await mailer.send(user.email, 'Tienes un pago pendiente')",
      '    sent++',
      '  })',
      '  return sent',
      '}',
    ),
  },
]
