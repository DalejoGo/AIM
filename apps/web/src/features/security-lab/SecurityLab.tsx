import { BurstDemo } from './BurstDemo'
import { HeadersCheck } from './HeadersCheck'

/** Seguridad en acción (DEC-011, OWASP Top 10): a real rate limit and the site's real security headers. */
export function SecurityLab() {
  return (
    <div class="grid gap-16">
      <BurstDemo />
      <HeadersCheck />
    </div>
  )
}
