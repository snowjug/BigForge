import type { TaskDetailDto } from '@bigforge/schemas';
import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/client';
import { keys } from '../../api/keys';
import type { MatchTextResponse } from '../../api/types';

/**
 * Why a task matches (or does not match) the families that exist now: the task's own prompt and CI log are
 * re-scored by the matcher playground (`POST /api/match`), which fingerprints text and changes nothing.
 * The key lives under `tasks` so a new identity or a new discovery drops it.
 */
export function useWhyMatched(taskId: string | null) {
  return useQuery({
    queryKey: [...keys.tasks.all, 'why', taskId ?? ''] as const,
    enabled: Boolean(taskId),
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const task = await http.get<TaskDetailDto>(`/api/tasks/${encodeURIComponent(taskId ?? '')}`, {
        signal,
      });
      const scored = await http.post<MatchTextResponse>(
        '/api/match',
        { prompt: task.prompt, log: task.originalLog },
        { signal },
      );
      return { task, ...scored };
    },
  });
}
