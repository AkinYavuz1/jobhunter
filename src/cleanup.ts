import { getExpiredJobIds, deleteJob, deleteFolder } from './storage.js';

export async function runCleanup(retentionDays: number, errors: string[]): Promise<number> {
  let deleted = 0;
  try {
    const ids = await getExpiredJobIds(retentionDays);
    for (const id of ids) {
      try {
        await deleteFolder(`jobs/${id}`);
        await deleteJob(id); // cascades to documents + notified
        deleted++;
      } catch (err) {
        errors.push(`Cleanup failed for ${id}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`Cleanup query failed: ${(err as Error).message}`);
  }
  return deleted;
}
