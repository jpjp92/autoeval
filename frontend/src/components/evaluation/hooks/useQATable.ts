import { useState } from 'react';
import { getQAStatus } from '@/src/lib/evalScoreUtils';
import { QA_PAGE_SIZE } from '@/src/types/evaluation';
import type { QAStatus, QAPreviewItem } from '@/src/types/evaluation';

export function useQATable(qaPreview: QAPreviewItem[]) {
  const [qaPage, setQaPage]           = useState(0);
  const [statusFilter, setStatusFilter] = useState<QAStatus | null>(null);
  const [sortCol, setSortCol]         = useState<string | null>(null);
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('asc');
  const [selectedQA, setSelectedQA]   = useState<QAPreviewItem | null>(null);

  const filteredQA = statusFilter
    ? qaPreview.filter(qa => getQAStatus(qa) === statusFilter)
    : qaPreview;

  const sortedQA = sortCol ? [...filteredQA].sort((a, b) => {
    let av: any, bv: any;
    if (sortCol === 'id')           { av = a.qa_index;        bv = b.qa_index; }
    else if (sortCol === 'intent')  { av = a.intent ?? '';    bv = b.intent ?? ''; }
    else if (sortCol === 'q')       { av = a.q ?? '';         bv = b.q ?? ''; }
    else if (sortCol === 'a')       { av = a.a ?? '';         bv = b.a ?? ''; }
    else if (sortCol === 'quality') { av = a.quality_avg ?? -1; bv = b.quality_avg ?? -1; }
    else if (sortCol === 'triad')   { av = a.rag_avg ?? -1;   bv = b.rag_avg ?? -1; }
    else if (sortCol === 'status')  { av = getQAStatus(a);    bv = getQAStatus(b); }
    else if (sortCol === 'failure') { av = a.primary_failure ?? ''; bv = b.primary_failure ?? ''; }
    else return 0;
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  }) : filteredQA;

  const totalPages = Math.max(1, Math.ceil(sortedQA.length / QA_PAGE_SIZE));
  const pagedQA    = sortedQA.slice(qaPage * QA_PAGE_SIZE, (qaPage + 1) * QA_PAGE_SIZE);

  const resetTable = () => {
    setQaPage(0);
    setStatusFilter(null);
    setSelectedQA(null);
  };

  return {
    qaPage, setQaPage,
    statusFilter, setStatusFilter,
    sortCol, setSortCol,
    sortDir, setSortDir,
    selectedQA, setSelectedQA,
    filteredQA, sortedQA, totalPages, pagedQA,
    resetTable,
  };
}
