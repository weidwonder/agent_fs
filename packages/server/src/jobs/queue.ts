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
  const jobId = await boss.send(JOB_INDEX_FILE, job, { singletonKey: job.fileId });

  if (!jobId) {
    throw new Error(`Failed to enqueue indexing job for file ${job.fileId}`);
  }

  return jobId;
}

export const JOB_REEMBED_FILE = 'reembed-file';

export interface ReembedFileJob {
  tenantId: string;
  fileId: string;
  directoryId: string;
}

export async function enqueueReembed(
  boss: PgBoss,
  job: ReembedFileJob,
): Promise<string | null> {
  const jobId = await boss.send(JOB_REEMBED_FILE, job, { singletonKey: job.fileId });

  if (!jobId) {
    throw new Error(`Failed to enqueue reembed job for file ${job.fileId}`);
  }

  return jobId;
}
