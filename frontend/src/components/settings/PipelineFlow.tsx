import {
  ReactFlow,
  Controls,
  type Node,
  type Edge,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ── 레이아웃 상수 ────────────────────────────────────────────
const C   = [0, 280, 560, 840, 1120]; // 컬럼 left X
const GW  = 240;  // 그룹 너비
const NW  = 210;  // 노드 너비
const NOX = (GW - NW) / 2; // 노드 x offset 내 그룹 (= 15)
const GY  = 72;   // 그룹 top Y (upload 아래)
const NS  = 64;   // 노드 간격

function nx(col: number) { return C[col] + NOX; }
function ny(idx: number) { return GY + 28 + idx * NS; }
function gh(n: number)   { return 28 + n * NS + 12; }  // 그룹 높이 (n = 노드 수)

// ── STEP 별 색상 ─────────────────────────────────────────────
const PALETTE = [
  { bg: 'var(--pipeline-s1-bg)', bd: 'var(--pipeline-s1-bd)', tx: 'var(--pipeline-s1-tx)' },
  { bg: 'var(--pipeline-s2-bg)', bd: 'var(--pipeline-s2-bd)', tx: 'var(--pipeline-s2-tx)' },
  { bg: 'var(--pipeline-s3-bg)', bd: 'var(--pipeline-s3-bd)', tx: 'var(--pipeline-s3-tx)' },
  { bg: 'var(--pipeline-s4-bg)', bd: 'var(--pipeline-s4-bd)', tx: 'var(--pipeline-s4-tx)' },
  { bg: 'var(--pipeline-s5-bg)', bd: 'var(--pipeline-s5-bd)', tx: 'var(--pipeline-s5-tx)' },
];

// ── 커스텀 노드 컴포넌트 ─────────────────────────────────────

// 그룹 배경 (라벨 포함, non-interactive)
function BgNode({ data }: { data: any }) {
  return (
    <div style={{
      width: data.w, height: data.h,
      background: data.bg,
      border: `1.5px dashed ${data.bd}`,
      borderRadius: 14,
      pointerEvents: 'none',
      position: 'relative',
    }}>
      <span style={{
        position: 'absolute', top: 8, left: 12,
        color: data.tx, fontWeight: 700, fontSize: 10.5,
        letterSpacing: '0.01em',
      }}>{data.label}</span>
    </div>
  );
}

// 처리 단계 노드
function StepNode({ data }: { data: any }) {
  return (
    <div style={{
      width: NW,
      background: data.color ?? 'var(--pipeline-nd-bg)',
      border: `1.5px solid ${data.bd}`,
      borderRadius: 9,
      padding: '7px 10px',
      fontSize: 11,
      color: data.tx ?? 'var(--pipeline-nd-tx)',
      textAlign: 'center',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <Handle type="target" position={Position.Top}   style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left}  style={{ opacity: 0 }} id="left" />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} id="right" />
      <div style={{ fontWeight: 700, lineHeight: 1.4, wordBreak: 'keep-all' }}>{data.label}</div>
      {data.sub && (
        <div style={{ fontWeight: 400, fontSize: 9.5, opacity: 0.7, marginTop: 2, lineHeight: 1.35, wordBreak: 'keep-all' }}>
          {data.sub}
        </div>
      )}
    </div>
  );
}

// DB 저장소 노드
function DbNode({ data }: { data: any }) {
  return (
    <div style={{
      width: NW,
      background: 'var(--pipeline-db-bg)',
      border: '1.5px solid var(--pipeline-db-bd)',
      borderRadius: 9,
      padding: '6px 10px',
      fontSize: 10,
      color: 'var(--pipeline-db-tx)',
      textAlign: 'center',
      fontWeight: 600,
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <Handle type="target" position={Position.Top}    style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right}  style={{ opacity: 0 }} id="right" />
      <div style={{ wordBreak: 'keep-all' }}>🗄 {data.label}</div>
    </div>
  );
}

const nodeTypes = { bg: BgNode, step: StepNode, db: DbNode };

// ── 노드 정의 ────────────────────────────────────────────────
function s(id: string, col: number, row: number, label: string, sub: string | undefined, ci: number, extra?: object): Node {
  return { id, type: 'step', position: { x: nx(col), y: ny(row) }, zIndex: 2,
    data: { label, sub, bd: PALETTE[ci].bd, tx: PALETTE[ci].tx, ...extra } };
}
function d(id: string, col: number, row: number, label: string): Node {
  return { id, type: 'db', position: { x: nx(col), y: ny(row) }, zIndex: 2, data: { label } };
}
function g(id: string, col: number, n: number, label: string, ci: number): Node {
  return { id, type: 'bg', position: { x: C[col] - 5, y: GY - 4 },
    selectable: false, draggable: false, zIndex: -1,
    data: { label, w: GW + 10, h: gh(n), bg: PALETTE[ci].bg, bd: PALETTE[ci].bd, tx: PALETTE[ci].tx } };
}

const nodes: Node[] = [
  // ── 업로드 ──
  { id: 'upload', type: 'step', position: { x: nx(0), y: GY - 52 }, zIndex: 2,
    data: { label: '📄 PDF / DOCX 업로드', bd: 'var(--pipeline-s1-bd)', tx: 'var(--pipeline-s1-tx)', color: 'var(--pipeline-s1-bg)' } },

  // ── S1: 데이터 규격화 ── (4 nodes)
  g('g1', 0, 4, 'STEP 1  ·  데이터 규격화', 0),
  s('s1-parse',  0, 0, 'PDF / DOCX 파싱',    'LLM 청킹 (기본) · 노이즈 정제',    0),
  s('s1-norm',   0, 1, '정규화 · 중복 확인',  '특수문자 정리 · 버전별 중복 체크',  0),
  s('s1-embed',  0, 2, 'Gemini Embedding 2',  '1536차원 벡터 변환',               0),
  d('db1',       0, 3, 'DB 저장: doc_chunks'),

  // ── S2: 계층 태깅 ── (4 nodes: master → doc_metadata → tag → doc_chunks.metadata)
  g('g2', 1, 4, 'STEP 2  ·  계층 태깅', 1),
  s('s2-master', 1, 0, '단계 1 — 계층 분석·생성', 'H1/H2/H3 생성 · 도메인 프로파일', 1),
  d('db2a',      1, 1, 'DB 저장: doc_metadata'),
  s('s2-tag',    1, 2, '단계 2 — 청크 태깅',   'H1/H2/H3 태그 · 버전별 추적', 1),
  d('db2',       1, 3, 'DB 저장: doc_chunks.metadata'),

  // ── S3: QA 생성 ── (4 nodes)
  g('g3', 2, 4, 'STEP 3  ·  QA 생성', 2),
  s('s3-filter', 2, 0, 'H1/H2 필터 조회',  'content 기반 · chunk ID 조회',     2),
  s('s3-prof',   2, 1, '도메인 분석',       'doc_metadata 캐시 우선',            2),
  s('s3-gen',    2, 2, 'QA 생성 (병렬처리)', '8종 의도 기반 · reasoning 포함',   2),
  d('db3',       2, 3, 'DB 저장: qa_generation_results'),

  // ── S4: 평가 ── (5 nodes)
  g('g4', 3, 5, 'STEP 4  ·  QA 평가', 3),
  s('s4-syn',   3, 0, 'Syntax 검사',       '필드·reasoning·길이 검사',       3),
  s('s4-stat',  3, 1, 'Statistics 검사',   '다양성 · 중복률',                 3),
  s('s4-qual',  3, 2, '통합 품질 검사',    '관련성·근거성·맥락성·완전성',      3),
  s('s4-score', 3, 3, '최종 점수 집계',   'RAG ×0.65 / 품질 ×0.25 / 구문·통계 ×0.1', 3),
  d('db4', 3, 4, 'DB 저장: qa_evaluation_scores'),

  // ── S5: 결과 확인 ── (3 nodes)
  g('g5', 4, 3, 'STEP 5  ·  결과 확인', 4),
  s('s5-eval',   4, 0, '평가 결과 확인',   'QA 상세 · 레이어별 점수',       4),
  s('s5-export', 4, 1, '리포트 내보내기',  'HTML / CSV / JSON / ZIP',        4),
  s('s5-dash',   4, 2, '대시보드',         '집계 지표 · 점수 추이 · 등급 분포', 4),
];

// ── 엣지 ────────────────────────────────────────────────────
const iv = { stroke: 'var(--pipeline-edge)', strokeWidth: 1.5 };  // within group
const xv = { stroke: 'var(--pipeline-edge-x)', strokeWidth: 2 };    // cross group (animated)

const edges: Edge[] = [
  // Upload → S1
  { id: 'e-up',    source: 'upload',    target: 's1-parse',  style: iv },

  // S1 내부
  { id: 'e-1a',    source: 's1-parse',  target: 's1-norm',   style: iv },
  { id: 'e-1b',    source: 's1-norm',   target: 's1-embed',  style: iv },
  { id: 'e-1c',    source: 's1-embed',  target: 'db1',       style: iv },

  // S1 → S2 (cross)
  { id: 'e-x12',   source: 'db1',    target: 's2-master',
    sourceHandle: 'right', targetHandle: 'left',
    type: 'smoothstep', animated: true, style: xv },

  // S2 내부
  { id: 'e-2a',    source: 's2-master', target: 'db2a',      style: iv },
  { id: 'e-2a2',   source: 'db2a',      target: 's2-tag',    style: iv },
  { id: 'e-2b',    source: 's2-tag',    target: 'db2',       style: iv },

  // S2 → S3 (cross)
  { id: 'e-x23',   source: 'db2',    target: 's3-filter',
    sourceHandle: 'right', targetHandle: 'left',
    type: 'smoothstep', animated: true, style: xv },

  // S3 내부
  { id: 'e-3a',    source: 's3-filter', target: 's3-prof',   style: iv },
  { id: 'e-3b',    source: 's3-prof',   target: 's3-gen',    style: iv },
  { id: 'e-3c',    source: 's3-gen',    target: 'db3',       style: iv },

  // S3 → S4 (cross)
  { id: 'e-x34',   source: 'db3',    target: 's4-syn',
    sourceHandle: 'right', targetHandle: 'left',
    type: 'smoothstep', animated: true, style: xv },

  // S4 내부
  { id: 'e-4a',    source: 's4-syn',   target: 's4-stat',   style: iv },
  { id: 'e-4b',    source: 's4-stat',  target: 's4-qual',   style: iv },
  { id: 'e-4c',    source: 's4-qual',  target: 's4-score',  style: iv },
  { id: 'e-4d',    source: 's4-score', target: 'db4',       style: iv },

  // S4 → S5 (cross)
  { id: 'e-x45',   source: 'db4',      target: 's5-eval',
    sourceHandle: 'right', targetHandle: 'left',
    type: 'smoothstep', animated: true, style: xv },

  // S5 내부
  { id: 'e-5a',    source: 's5-eval',   target: 's5-export', style: iv },
  { id: 'e-5b',    source: 's5-export', target: 's5-dash',   style: iv },
];

// ── 컴포넌트 ─────────────────────────────────────────────────
export function PipelineFlow() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        minZoom={0.3}
        maxZoom={2}
        nodesDraggable={false}
        panOnDrag={true}
        zoomOnScroll={true}
        proOptions={{ hideAttribution: true }}
      >
        <Controls
          style={{ bottom: 4, right: 10, left: 'auto', top: 'auto', transform: 'scale(0.75)', transformOrigin: 'bottom right' }}
          showInteractive={false}
        />
      </ReactFlow>
    </div>
  );
}
