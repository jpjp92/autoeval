import * as XLSX from 'xlsx';
import { INTENT_KR, FAILURE_CONFIG, LANGUAGE_POLICY_LABEL, V2_DIMENSIONS, GRADE_WITHHELD_LABEL, VERDICT_LABEL } from '@/src/types/evaluation';
import type { QAPreviewItem } from '@/src/types/evaluation';
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

const V2_STATUS_KR: Record<string, string> = {
  pass: '통과', fail: '불통과', hard_fail: '근거·수치 오류', error: '평가 실패', skipped: '제외(구문)', missing: '결과 없음',
};

/** 평가 v2: Summary · Validation · Detail · Evidence 시트 (기획 3장) */
function buildV2Workbook(data: EvaluationData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { validation, judge, conclusion } = data.v2!;
  const fl = (k: string) => FAILURE_CONFIG[k]?.label ?? k;
  const rows = data.detailedQA.map(d => d.v2).filter(Boolean) as QAPreviewItem[];
  const n = (v: number | null | undefined) => (v == null ? '' : Number(v.toFixed(3)));

  const sum: (string | number)[][] = [
    ['[ 메타데이터 ]', ''],
    ['평가 방식', `v2 (${data.metadata?.judge_version ?? judge.judge_version})`],
    ['QA 생성 모델', data.metadata?.qa_model || '-'],
    ['평가 모델', data.metadata?.eval_model || '-'],
    ['평가 일시 (KST)', formatKST(data.metadata?.timestamp ?? new Date().toISOString())],
    ['출처 문서', data.metadata?.source || '-'],
    [],
    ['[ 결론 ]', conclusion],
    [],
    ['[ 요약 ]', ''],
    ['전체 QA', validation.total],
    ['평가된 QA', judge.judged_count],
    ['품질 통과', judge.pass_count],
    ['통과율 (%)', judge.pass_rate],
    ['등급', judge.grade ?? `보류 (${GRADE_WITHHELD_LABEL[judge.grade_withheld ?? ''] ?? judge.grade_withheld ?? ''})`],
    ['최종 점수', n(judge.final_score)],
    ['근거·수치 오류', judge.hard_fail_count],
    ['평가 실패', judge.evaluation_error_count],
    [],
    ['[ 지표 평균 (0-1) ]', ''],
    ...V2_DIMENSIONS.map(d => [d.label, n(judge.averages?.[d.key])] as (string | number)[]),
    [],
    ['[ 실패 유형 ]', '건수'],
    ...Object.entries(judge.failure_counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [fl(k), v] as (string | number)[]),
    [],
    ['[ 언어 조합 ]', '판정 / 통과율(%) / 평균 QA 점수'],
    ...Object.entries(judge.by_language_policy ?? {}).map(([k, v]) => [LANGUAGE_POLICY_LABEL[k] ?? k, `${v.judged} / ${v.pass_rate} / ${v.avg_qa_score}`] as (string | number)[]),
    [],
    ['[ 평가 기준 ]', ''],
    ['QA 점수', V2_DIMENSIONS.map(d => `${d.label} ${Math.round((judge.weights?.[d.key] ?? 0) * 100)}%`).join(' · ')],
    ['근거·수치 오류', '근거성·정확성 0.6 미만 또는 원문 모순 주장 → 불통과, 최종 점수 0.5배'],
    ['통과', '근거·수치 오류 없음 + QA 점수 ≥ 0.70 + 질문 품질 ≥ 0.5'],
    ['등급', 'A+ 0.95 · A 0.85 · B+ 0.75 · B 0.65 · C 0.50 · 평가 실패 20% 초과 시 보류'],
  ];
  const wsSum = XLSX.utils.aoa_to_sheet(sum);
  wsSum['!cols'] = [{ wch: 22 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsSum, 'Summary');

  const qOf = new Map(rows.map(r => [r.qa_index, r.q]));
  const val: (string | number)[][] = [
    ['[ 구문 검증 ]', ''], ['전체', validation.total], ['정상', validation.valid], ['탈락', validation.invalid], [],
    ['[ 구문 탈락 QA ]', '사유'],
    ...rows.filter(r => r.v2_status === 'skipped').map(r => [`#${r.qa_index + 1} ${r.q}`, r.failure_reason ?? ''] as (string | number)[]),
    [],
    ['[ 중복 의심 쌍 ]', '유사도', '질문 A', '질문 B'],
    ...validation.duplicates.map(d => [`#${d.a + 1} ↔ #${d.b + 1}`, d.similarity, qOf.get(d.a) ?? '', qOf.get(d.b) ?? ''] as (string | number)[]),
    [],
    ['[ 질문 의도 분포 ]', '개수'],
    ...Object.entries(validation.intent_distribution ?? {}).map(([k, v]) => [INTENT_KR[k] ?? k, v] as (string | number)[]),
  ];
  const wsVal = XLSX.utils.aoa_to_sheet(val);
  wsVal['!cols'] = [{ wch: 50 }, { wch: 40 }, { wch: 50 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsVal, 'Validation');

  const header = ['ID', '의도', '질문', '답변', '판정', 'QA 점수', ...V2_DIMENSIONS.map(d => d.label), '실패 사유', '언어', '판정 이유', 'Context'];
  const detail = rows.map(r => [
    r.qa_index + 1, INTENT_KR[r.intent] ?? r.intent, r.q, r.a ?? '', V2_STATUS_KR[r.v2_status ?? ''] ?? '',
    n(r.qa_score), ...V2_DIMENSIONS.map(d => n(r[d.key] as number | undefined)),
    Array.from(new Set([...(r.hard_fail_reasons ?? []), ...(r.v2_failure_types ?? []), ...(r.fail_reasons ?? [])])).map(fl).join(', '),
    r.language_policy ? LANGUAGE_POLICY_LABEL[r.language_policy] ?? r.language_policy : '',
    r.reason || r.failure_reason || '', r.context ?? '',
  ]);
  const wsDetail = XLSX.utils.aoa_to_sheet([header, ...detail]);
  wsDetail['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 50 }, { wch: 50 }, { wch: 14 }, { wch: 9 },
    ...V2_DIMENSIONS.map(() => ({ wch: 9 })), { wch: 30 }, { wch: 8 }, { wch: 60 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail');

  const VERDICT_KR = VERDICT_LABEL;
  const ev = rows.flatMap(r => (r.evidence ?? []).map(e => [r.qa_index + 1, VERDICT_KR[e.verdict] ?? e.verdict, e.claim, e.source]));
  const wsEv = XLSX.utils.aoa_to_sheet([['QA ID', '판정', '주장', '원문 인용'], ...ev]);
  wsEv['!cols'] = [{ wch: 7 }, { wch: 10 }, { wch: 60 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsEv, 'Evidence');
  return wb;
}

export function buildWorkbook(data: EvaluationData): XLSX.WorkBook {
  if (data.v2) return buildV2Workbook(data);
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
