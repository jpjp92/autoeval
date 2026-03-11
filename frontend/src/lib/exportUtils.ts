/**
 * Export utilities for evaluation results
 * Supports CSV, HTML, and JSON formats
 */

interface EvaluationData {
  summaryStats: Array<{ label: string; value: string; icon?: string; color?: string; bg?: string }>;
  layer1Stats: Array<{ subject: string; A: number; fullMark: number }>;
  intentDistribution: Array<{ name: string; value: number }>;
  llmQualityScores: Array<{ name: string; score: number }>;
  detailedQA: Array<{
    id: number;
    q: string;
    intent: string;
    l2_avg: number;
    triad_avg: number;
    pass: boolean;
  }>;
  metadata?: {
    model?: string;
    prompt?: string;
    lang?: string;
    timestamp?: string;
  };
}

/**
 * Export evaluation results to CSV
 */
export function exportToCSV(data: EvaluationData): void {
  let csvContent = 'data:text/csv;charset=utf-8,';

  // Summary stats section
  csvContent += '=== SUMMARY STATISTICS ===\n';
  csvContent += 'Metric,Value\n';
  data.summaryStats.forEach((stat) => {
    csvContent += `${stat.label},${stat.value}\n`;
  });
  csvContent += '\n';

  // Layer 1 stats
  csvContent += '=== LAYER 1: DATASET STATISTICS ===\n';
  csvContent += 'Subject,Score,Full Mark\n';
  data.layer1Stats.forEach((stat) => {
    csvContent += `${stat.subject},${stat.A},${stat.fullMark}\n`;
  });
  csvContent += '\n';

  // Intent distribution
  csvContent += '=== INTENT DISTRIBUTION ===\n';
  csvContent += 'Intent,Count\n';
  data.intentDistribution.forEach((intent) => {
    csvContent += `${intent.name},${intent.value}\n`;
  });
  csvContent += '\n';

  // Layer 2 & Triad scores
  csvContent += '=== LAYER 2 & TRIAD SCORES ===\n';
  csvContent += 'Metric,Score\n';
  data.llmQualityScores.forEach((score) => {
    csvContent += `${score.name},${score.score.toFixed(2)}\n`;
  });
  csvContent += '\n';

  // Detailed QA results
  csvContent += '=== DETAILED QA EVALUATION RESULTS ===\n';
  csvContent += 'ID,Intent,Question,L2 Avg,Triad Avg,Status\n';
  data.detailedQA.forEach((qa) => {
    const status = qa.pass ? 'PASS' : 'FAIL';
    // Escape quotes in question
    const question = `"${qa.q.replace(/"/g, '""')}"`;
    csvContent += `${qa.id},${qa.intent},${question},${qa.l2_avg.toFixed(2)},${qa.triad_avg.toFixed(2)},${status}\n`;
  });

  // Metadata
  if (data.metadata) {
    csvContent += '\n=== METADATA ===\n';
    csvContent += `Model,${data.metadata.model || 'N/A'}\n`;
    csvContent += `Prompt Version,${data.metadata.prompt || 'N/A'}\n`;
    csvContent += `Language,${data.metadata.lang || 'N/A'}\n`;
    csvContent += `Timestamp,${data.metadata.timestamp || new Date().toISOString()}\n`;
  }

  // Download
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `evaluation-report-${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export evaluation results to HTML
 */
export function exportToHTML(data: EvaluationData): void {
  const timestamp = new Date().toLocaleString();
  const intentColorsMap: Record<string, string> = {
    factoid: '#06b6d4',
    numeric: '#eab308',
    procedure: '#3b82f6',
    why: '#d946ef',
    how: '#22c55e',
    definition: '#0ea5e9',
    list: '#f59e0b',
    boolean: '#c026d3',
  };

  let htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QA Evaluation Report</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f8fafc;
            color: #1e293b;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
        }
        
        header {
            background: white;
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 30px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            border-left: 4px solid #4f46e5;
        }
        
        h1 {
            font-size: 28px;
            margin-bottom: 10px;
        }
        
        .metadata {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
        }
        
        .metadata-item {
            font-size: 14px;
        }
        
        .metadata-label {
            color: #64748b;
            font-weight: 500;
            margin-bottom: 5px;
        }
        
        .metadata-value {
            color: #1e293b;
            font-weight: 600;
        }
        
        section {
            margin-bottom: 30px;
        }
        
        section h2 {
            font-size: 20px;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e2e8f0;
            color: #1e293b;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            border-left: 4px solid #4f46e5;
        }
        
        .stat-label {
            color: #64748b;
            font-size: 12px;
            text-transform: uppercase;
            margin-bottom: 8px;
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        
        .stat-value {
            font-size: 24px;
            font-weight: 700;
            color: #1e293b;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        thead {
            background: #f1f5f9;
            border-bottom: 2px solid #e2e8f0;
        }
        
        th {
            padding: 15px;
            text-align: left;
            font-weight: 600;
            color: #64748b;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        td {
            padding: 15px;
            border-bottom: 1px solid #e2e8f0;
            font-size: 14px;
        }
        
        tbody tr:last-child td {
            border-bottom: none;
        }
        
        tbody tr:hover {
            background: #f8fafc;
        }
        
        .intent-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            border: 1px solid;
        }
        
        .score-pass {
            color: #059669;
            font-weight: 600;
            font-family: 'Courier New', monospace;
        }
        
        .score-fail {
            color: #dc2626;
            font-weight: 700;
            font-family: 'Courier New', monospace;
        }
        
        .status-pass {
            display: inline-block;
            padding: 4px 12px;
            background: #d1fae5;
            color: #047857;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            border: 1px solid #a7f3d0;
        }
        
        .status-fail {
            display: inline-block;
            padding: 4px 12px;
            background: #fee2e2;
            color: #991b1b;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            border: 1px solid #fecaca;
        }
        
        .distribution-list {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        }
        
        .distribution-item {
            background: white;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        
        .distribution-name {
            font-weight: 600;
            margin-bottom: 5px;
            font-size: 14px;
        }
        
        .distribution-count {
            font-size: 20px;
            font-weight: 700;
            color: #4f46e5;
        }
        
        footer {
            margin-top: 50px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
            text-align: center;
            color: #94a3b8;
            font-size: 12px;
        }
        
        @media print {
            body {
                background: white;
            }
            section {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>📊 QA Evaluation Report</h1>
            <p style="color: #64748b; margin-bottom: 20px;">Comprehensive evaluation results including dataset statistics, quality scores, and detailed QA analysis</p>
            <div class="metadata">
                <div class="metadata-item">
                    <div class="metadata-label">Model</div>
                    <div class="metadata-value">${data.metadata?.model || 'N/A'}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Prompt Version</div>
                    <div class="metadata-value">${data.metadata?.prompt || 'N/A'}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Language</div>
                    <div class="metadata-value">${data.metadata?.lang || 'N/A'}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Generated At</div>
                    <div class="metadata-value">${timestamp}</div>
                </div>
            </div>
        </header>
        
        <!-- Summary Statistics -->
        <section>
            <h2>📈 Summary Statistics</h2>
            <div class="stats-grid">
                ${data.summaryStats
                  .map(
                    (stat) =>
                      `<div class="stat-card">
                    <div class="stat-label">${stat.label}</div>
                    <div class="stat-value">${stat.value}</div>
                </div>`
                  )
                  .join('')}
            </div>
        </section>
        
        <!-- Layer 1 Stats -->
        <section>
            <h2>🎯 Layer 1: Dataset Statistics</h2>
            <table>
                <thead>
                    <tr>
                        <th>Subject</th>
                        <th>Score</th>
                        <th>Full Mark</th>
                        <th>Percentage</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.layer1Stats
                      .map(
                        (stat) =>
                          `<tr>
                        <td><strong>${stat.subject}</strong></td>
                        <td>${stat.A.toFixed(2)}</td>
                        <td>${stat.fullMark}</td>
                        <td>${((stat.A / stat.fullMark) * 100).toFixed(1)}%</td>
                    </tr>`
                      )
                      .join('')}
                </tbody>
            </table>
        </section>
        
        <!-- Intent Distribution -->
        <section>
            <h2>🔀 Intent Distribution</h2>
            <div class="distribution-list">
                ${data.intentDistribution
                  .map(
                    (intent) =>
                      `<div class="distribution-item" style="border-left-color: ${
                        intentColorsMap[intent.name] || '#4f46e5'
                      }">
                    <div class="distribution-name">${intent.name}</div>
                    <div class="distribution-count">${intent.value}</div>
                </div>`
                  )
                  .join('')}
            </div>
        </section>
        
        <!-- Layer 2 & Triad Scores -->
        <section>
            <h2>⭐ Layer 2 & Triad Quality Scores</h2>
            <table>
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Score</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.llmQualityScores
                      .map(
                        (score) => {
                          const status =
                            score.score >= 0.85 ? 'Excellent' : score.score >= 0.7 ? 'Good' : 'Needs Improvement';
                          const statusClass =
                            score.score >= 0.85 ? 'status-pass' : score.score >= 0.7 ? 'status-pass' : 'status-fail';
                          return `<tr>
                        <td><strong>${score.name}</strong></td>
                        <td><span class="${score.score >= 0.7 ? 'score-pass' : 'score-fail'}">${score.score.toFixed(2)}</span></td>
                        <td><span class="${statusClass}">${status}</span></td>
                    </tr>`;
                        }
                      )
                      .join('')}
                </tbody>
            </table>
        </section>
        
        <!-- Detailed QA Results -->
        <section>
            <h2>📋 Detailed QA Evaluation Results</h2>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Intent</th>
                        <th>Question</th>
                        <th>L2 Avg</th>
                        <th>Triad Avg</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.detailedQA
                      .map(
                        (qa) =>
                          `<tr>
                        <td><strong>${qa.id}</strong></td>
                        <td>
                            <div class="intent-badge" style="background-color: ${
                              intentColorsMap[qa.intent] || '#4f46e5'
                            }15; border-color: ${intentColorsMap[qa.intent] || '#4f46e5'}30; color: ${
                            intentColorsMap[qa.intent] || '#4f46e5'
                          }">
                                ${qa.intent}
                            </div>
                        </td>
                        <td>${qa.q}</td>
                        <td><span class="${qa.l2_avg >= 0.7 ? 'score-pass' : 'score-fail'}">${qa.l2_avg.toFixed(2)}</span></td>
                        <td><span class="${qa.triad_avg >= 0.7 ? 'score-pass' : 'score-fail'}">${qa.triad_avg.toFixed(2)}</span></td>
                        <td><span class="${qa.pass ? 'status-pass' : 'status-fail'}">${qa.pass ? 'PASS' : 'FAIL'}</span></td>
                    </tr>`
                      )
                      .join('')}
                </tbody>
            </table>
        </section>
        
        <footer>
            <p>Generated on ${timestamp} | Auto Evaluation Dashboard</p>
        </footer>
    </div>
</body>
</html>
  `;

  // Download
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `evaluation-report-${Date.now()}.html`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export evaluation results to JSON
 */
export function exportToJSON(data: EvaluationData): void {
  const jsonContent = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `evaluation-report-${Date.now()}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
