import { useState, useEffect, useRef } from 'react';
import { getEvalHistory, getEvalExportById } from '@/src/lib/api';
import { buildChartDataFromHistory } from '@/src/lib/evalChartUtils';
import type { QAPreviewItem, HistoryItem } from '@/src/types/evaluation';

export type HistoryReport = {
  summaryStats: any[];
  layer1Stats: any[];
  intentDistribution: any[];
  llmQualityScores: any[];
  item: HistoryItem;
};

export function useEvalHistory(
  initialEvalDbId: string | null | undefined,
  onSelect?: () => void,
) {
  const [historyList, setHistoryList]           = useState<HistoryItem[]>([]);
  const [historyReport, setHistoryReport]       = useState<HistoryReport | null>(null);
  const [historyQaPreview, setHistoryQaPreview] = useState<QAPreviewItem[]>([]);
  const [historyQaLoading, setHistoryQaLoading] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [showHistoryMenu, setShowHistoryMenu]   = useState(false);
  const onSelectRef                             = useRef(onSelect);

  useEffect(() => { onSelectRef.current = onSelect; });

  // 마운트 시 히스토리 목록 로드
  useEffect(() => {
    getEvalHistory().then((res) => {
      if (res.success && Array.isArray((res as any).history)) {
        setHistoryList((res as any).history);
      }
    });
  }, []);

  // 대시보드 진입 시 initialEvalDbId 자동 선택
  useEffect(() => {
    if (!initialEvalDbId || !historyList.length) return;
    const target = historyList.find((h) => h.id === initialEvalDbId);
    if (target) selectHistory(target);
  }, [initialEvalDbId, historyList]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectHistory = async (item: HistoryItem) => {
    onSelectRef.current?.();
    setSelectedHistoryId(item.id);
    setHistoryReport({ ...buildChartDataFromHistory(item), item });
    setHistoryQaPreview([]);
    setShowHistoryMenu(false);
    setHistoryQaLoading(true);
    try {
      const res = await getEvalExportById(item.id) as any;
      if (res.success && Array.isArray(res.detail)) {
        setHistoryQaPreview(res.detail as QAPreviewItem[]);
      }
    } finally {
      setHistoryQaLoading(false);
    }
  };

  const clearHistory = () => {
    setHistoryReport(null);
    setSelectedHistoryId(null);
  };

  return {
    historyList,
    historyReport,
    historyQaPreview,
    historyQaLoading,
    selectedHistoryId,
    showHistoryMenu,
    setShowHistoryMenu,
    selectHistory,
    clearHistory,
  };
}
