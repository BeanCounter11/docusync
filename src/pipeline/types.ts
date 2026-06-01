import type { MapResult } from '../map/semantic-mapper.js';

export type PipelineItemStatus =
  | 'updated'
  | 'draft_created'
  | 'skipped'
  | 'failed'
  | 'dry_run_update'
  | 'dry_run_draft';

export interface PipelineItemResult {
  mapResult: MapResult;
  status: PipelineItemStatus;
  outputPath?: string;
  changeSummary?: string;
  linesSynced?: number;
  message?: string;
}

export interface PipelineRunResult {
  items: PipelineItemResult[];
  dryRun: boolean;
}
