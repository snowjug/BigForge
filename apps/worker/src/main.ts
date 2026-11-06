import { Platform, loadConfig } from '@bigforge/platform';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * External job worker: processes queued jobs (shadow runs, drift canaries, mutations, batches)
 * from the shared database. Run the API with BIGFORGE_JOBS_MODE=external to leave jobs to this
 * process. The same code runs inline inside the API by default.
 */
async function main(): Promise<void> {
  const config = { ...loadConfig(process.env), jobsMode: 'external' as const };
  const platform = await Platform.create(config);
  const pollMs = Number(process.env.BIGFORGE_WORKER_POLL_MS ?? 500);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log(`BigForge worker started (poll ${pollMs} ms, database ${config.databaseFile})`);
  while (!stopping) {
    await platform.jobs.drain();
    await sleep(pollMs);
  }
  platform.close();
  console.log('BigForge worker stopped');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
