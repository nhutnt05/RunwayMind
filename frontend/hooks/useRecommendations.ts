'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RejectRecommendationRequestSchema } from '@runwaymind/shared';
import { api, type AgentDecisionJson } from '@/lib/api';
import { DECISION_POLL_MS, isTerminalDecision } from '@/lib/recommendations';

const LIST_REFRESH_MS = 5_000; // docs/08 §5 dashboard refresh

/** `/recommendations?status=PENDING_APPROVAL` for the dashboard (docs/08 §1). */
export function usePendingRecommendations() {
  return useQuery({
    queryKey: ['recommendations', 'PENDING_APPROVAL'],
    queryFn: () => api.get<AgentDecisionJson[]>('/recommendations?status=PENDING_APPROVAL'),
    refetchInterval: LIST_REFRESH_MS,
  });
}

/** Single decision, polled every 2 s until it reaches a terminal status (docs/07 §7). */
export function useRecommendation(id: string, enabled = true) {
  return useQuery({
    queryKey: ['recommendation', id],
    queryFn: async () => (await api.get<AgentDecisionJson>(`/recommendations/${encodeURIComponent(id)}`)).data,
    enabled,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && isTerminalDecision(d.status) ? false : DECISION_POLL_MS;
    },
  });
}

export function useDecideRecommendation() {
  const qc = useQueryClient();

  const onSettled = (decision: AgentDecisionJson | undefined) => {
    // Optimistic state: seed the per-id cache with the returned decision so the card switches immediately.
    if (decision) qc.setQueryData(['recommendation', decision.id], decision);
    void qc.invalidateQueries({ queryKey: ['recommendations'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
  };

  const approve = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<AgentDecisionJson>(`/recommendations/${encodeURIComponent(id)}/approve`)).data,
    onSuccess: onSettled,
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (
        await api.postValidated<typeof RejectRecommendationRequestSchema, AgentDecisionJson>(
          `/recommendations/${encodeURIComponent(id)}/reject`,
          RejectRecommendationRequestSchema,
          reason ? { reason } : {},
        )
      ).data,
    onSuccess: onSettled,
  });

  return { approve, reject };
}
