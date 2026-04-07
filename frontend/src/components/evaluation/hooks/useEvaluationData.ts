import { useState, useEffect, useRef } from 'react';
import { getEvalStatus } from '@/src/lib/api';
import type { EvalReport } from '@/src/types/evaluation';

export function useEvaluationData(
  evalJobId: string | null | undefined,
  onNewJob?: () => void,
) {
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [report, setReport]             = useState<EvalReport | null>(null);
  const prevEvalJobId                   = useRef<string | null>(null);
  const onNewJobRef                     = useRef(onNewJob);

  useEffect(() => { onNewJobRef.current = onNewJob; });

  useEffect(() => {
    if (!evalJobId || evalJobId === prevEvalJobId.current) return;
    prevEvalJobId.current = evalJobId;
    onNewJobRef.current?.();
    setLoading(true);
    setError(null);
    setReport(null);

    (async () => {
      try {
        const res = await getEvalStatus(evalJobId) as any;
        if (res.success && res.eval_report) {
          setReport(res.eval_report as EvalReport);
        } else {
          setError(res.error ?? '평가 결과를 불러오지 못했습니다.');
        }
      } catch {
        setError('네트워크 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    })();
  }, [evalJobId]);

  return { loading, error, report };
}
