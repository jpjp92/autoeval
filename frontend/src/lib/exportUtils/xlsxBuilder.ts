import * as XLSX from 'xlsx';
import { INTENT_KR } from '@/src/types/evaluation';
import { formatKST } from '@/src/lib/evalChartUtils';
import type { EvaluationData } from './types';

const FAILURE_KR: Record<string, string> = {
  hallucination:      '환각오류',
  faithfulness_error: '근거오류',
  poor_context:       '문맥부족',
  retrieval_miss:     '검색오류',
  ambiguous_question: '질문모호',
  bad_chunk:          '불량청크',
  evaluation_error:   '평가오류',
  low_quality:        '품질미달',
  syntax_error:       '구문오류',
};

export function buildWorkbook(data: EvaluationData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const evalDate = formatKST(data.metadata?.timestamp ?? new Date().toISOString());
  const qaModel   = data.metadata?.qa_model  || '-';
  const evalModel = data.metadata?.eval_model || '-';
  const source    = data.metadata?.source || '-';

  // ── Stats 시트 ──────────────────────────────────────────────────────────────
  const statsRows: (string | number)[][] = [];

  statsRows.push(['[ 메타데이터 ]', '']);
  statsRows.push(['QA 생성 모델',    qaModel]);
  statsRows.push(['평가 모델',       evalModel]);
  statsRows.push(['평가 일시 (KST)', evalDate]);
  statsRows.push(['출처 문서',       source]);
  statsRows.push([]);

  statsRows.push(['[ 요약 통계 ]', '']);
  statsRows.push(['항목', '값']);
  data.summaryStats.forEach((s) => statsRows.push([s.label, s.value]));
  statsRows.push([]);

  statsRows.push(['[ 데이터 통계 (0-10) ]', '']);
  statsRows.push(['지표', '점수']);
  data.layer1Stats.forEach((s) => statsRows.push([s.subject, s.A.toFixed(2)]));
  statsRows.push([]);

  statsRows.push(['[ 질문 의도 분포 ]', '']);
  statsRows.push(['의도', '개수']);
  data.intentDistribution.forEach((i) => {
    const displayName = i.krLabel ? `${i.krLabel}(${i.name})` : (i.label ?? i.name);
    statsRows.push([displayName, i.value]);
  });
  statsRows.push([]);

  statsRows.push(['[ 통합 품질 평가 점수 (0-1) ]', '']);
  statsRows.push(['지표', '점수']);
  data.llmQualityScores.forEach((s) => {
    const displayName = s.nameEn ? `${s.name}(${s.nameEn})` : s.name;
    statsRows.push([displayName, s.score.toFixed(2)]);
  });

  const wsStats = XLSX.utils.aoa_to_sheet(statsRows);
  wsStats['!cols'] = [{ wch: 28 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsStats, 'Stats');

  // ── Detail 시트 ─────────────────────────────────────────────────────────────
  const detailHeader = ['ID', '의도', 'Context', 'Question', 'Answer', '품질 점수', 'Triad 점수', '상태', '실패유형', '평가일시 (KST)'];
  const detailRows = data.detailedQA.map((qa) => {
    const qFail = (qa.l2_avg === undefined || qa.l2_avg === null) ? true : qa.l2_avg < 0.7;
    const rFail = (qa.triad_avg === undefined || qa.triad_avg === null) ? true : qa.triad_avg < 0.7;
    const hasError = (qa.pass === false) || (qa.failure_types && qa.failure_types.length > 0);

    let status = '성공';
    if (qFail && rFail) {
      status = '실패';
    } else if (qFail || rFail || hasError) {
      status = '보류';
    }
    const failureLabel = qa.primary_failure ? (FAILURE_KR[qa.primary_failure] ?? qa.primary_failure) : '-';
    return [
      qa.id,
      INTENT_KR[qa.intent] ?? qa.intent,
      qa.context ?? '',
      qa.q,
      qa.a ?? '',
      qa.l2_avg.toFixed(2),
      qa.triad_avg.toFixed(2),
      status,
      failureLabel,
      evalDate,
    ];
  });

  const wsDetail = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
  wsDetail['!cols'] = [
    { wch: 6 },   // ID
    { wch: 12 },  // 의도
    { wch: 55 },  // Context
    { wch: 50 },  // Question
    { wch: 50 },  // Answer
    { wch: 12 },  // 품질 점수
    { wch: 12 },  // Triad 점수
    { wch: 8  },  // 상태
    { wch: 12 },  // 실패유형
    { wch: 22 },  // 평가일시
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail');

  return wb;
}

export function exportToCSV(data: EvaluationData): void {
  const wb = buildWorkbook(data);
  const filename = `qa-evaluation-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
