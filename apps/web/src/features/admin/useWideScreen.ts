import { useEffect, useState } from 'preact/hooks'

/** Width from which the leads fit in a table; below it they are cards (down to 320 px). */
export const WIDE_QUERY = '(min-width: 64rem)'

/** True on screens wide enough for the table. False before hydration, so the first paint is the narrow view. */
export function useWideScreen(): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}
