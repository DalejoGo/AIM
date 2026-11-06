import { BeforeAfter } from './BeforeAfter'
import { Downloads } from './Downloads'
import { PreviewTabs } from './PreviewTabs'
import type { MigrationResult } from './types'

/**
 * Everything that only runs once there is a file: the pipeline (PapaParse and Zod) and the result panels.
 * DataMigrator imports this module on the first file, so the page loads without that code.
 */
export { runMigration } from './pipeline'

interface Props {
  result: MigrationResult
  sourceName: string
  /** Bumped on every new result so the preview starts again on its first tab. */
  run: number
  onDownloaded: (fileName: string) => void
}

export function Results({ result, sourceName, run, onDownloaded }: Props) {
  return (
    <>
      <BeforeAfter result={result} />
      <PreviewTabs key={run} result={result} />
      <Downloads result={result} sourceName={sourceName} onDownloaded={onDownloaded} />
    </>
  )
}
