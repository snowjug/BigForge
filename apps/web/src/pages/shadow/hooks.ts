import type { JobDto } from '@bigforge/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useJob, useReplayVersion, useStartShadow } from '../../api/hooks';
import { keys } from '../../api/keys';
import { useOptionalDemo } from '../../demo/useDemo';
import { useToast } from '../../ui';

const isLive = (job: JobDto | null | undefined): job is JobDto =>
  job !== null && job !== undefined && (job.status === 'queued' || job.status === 'running');

/**
 * Follows a Shadow Brain job for one Reflex version: the job started from this page, or the one the guided
 * demo's presenter is running. While it runs, the version's evidence is refreshed after every scenario so
 * counts and the comparison table fill in live.
 */
export function useShadowRun(versionId: string | null) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const start = useStartShadow();
  const [jobId, setJobId] = useState<string | null>(null);
  const followed = useJob(jobId);
  const demo = useOptionalDemo();
  const demoJob = demo?.activeJob?.type === 'shadow' ? demo.activeJob : null;
  const job = followed.data ?? demoJob;
  const live = isLive(job);
  const done = job?.progress.done ?? -1;

  useEffect(() => {
    if (!versionId || done < 0) return;
    void qc.invalidateQueries({ queryKey: keys.reflexes.version(versionId) });
  }, [qc, versionId, done]);

  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!job || announced.current === job.id) return;
    if (job.status === 'succeeded') {
      announced.current = job.id;
      toast({
        title: 'Shadow Brain finished',
        description: `${job.progress.done} of ${job.progress.total} scenarios ran. The evidence gate has been re-evaluated.`,
        tone: 'success',
      });
    } else if (job.status === 'failed') {
      announced.current = job.id;
      toast({
        title: 'Shadow Brain failed',
        description: job.error ?? 'The job failed.',
        tone: 'danger',
      });
    }
  }, [job, toast]);

  const run = async () => {
    if (!versionId) return;
    try {
      const { job: created } = await start.mutateAsync({ versionId });
      setJobId(created.id);
    } catch (error) {
      toast({
        title: 'Could not start Shadow Brain',
        description: errorMessage(error),
        tone: 'danger',
      });
    }
  };

  return { run, starting: start.isPending, job, live };
}

/** Replay (synchronous): while it runs, the version's evidence is polled so per-trace results appear live. */
export function useReplayRun(versionId: string | null) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const replay = useReplayVersion();
  const pending = replay.isPending;

  useEffect(() => {
    if (!pending || !versionId) return undefined;
    const timer = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: keys.reflexes.version(versionId) });
    }, 700);
    return () => {
      window.clearInterval(timer);
    };
  }, [pending, qc, versionId]);

  const run = async () => {
    if (!versionId) return;
    try {
      const result = await replay.mutateAsync(versionId);
      toast({
        title: `Replay finished: ${result.replay.agreements} of ${result.replay.runs} traces reproduced`,
        description:
          result.status === 'shadow'
            ? 'Every recorded task reproduced. The Reflex is now in Shadow.'
            : 'It stays a candidate until every trace reproduces.',
        tone: result.status === 'shadow' ? 'success' : 'warning',
      });
    } catch (error) {
      toast({ title: 'Replay failed', description: errorMessage(error), tone: 'danger' });
    }
  };

  return { run, pending, error: replay.error };
}
