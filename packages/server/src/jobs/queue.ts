// packages/server/src/jobs/queue.ts

import PgBoss from 'pg-boss';

export const JOB_INDEX_FILE = 'index-file';

export interface IndexFileJob {
  tenantId: string;
  projectId: string;
  directoryId: string;
  fileId: string;
  fileName: string;
  s3TempKey: string;
}

export async function enqueueIndexing(
  boss: PgBoss,
  job: IndexFileJob,
): Promise<string | null> {
  return boss.send(JOB_INDEX_FILE, job, { singletonKey: job.fileId });
}
