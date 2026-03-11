import { StatsGrid } from "./StatsCards";
import { ActivityChart } from "./ActivityChart";
import { Play, FileText, CheckCircle2, XCircle, Clock, ArrowRight } from "lucide-react";
import { cn } from "@/src/lib/utils";

export function DashboardOverview({ setActiveTab }: { setActiveTab: (tab: string) => void }) {
  const recentRuns = [
    { id: "RUN-0042", type: "생성", target: "Shop > USIM/eSIM", model: "GPT-5.1", status: "completed", items: 320, time: "2분 14초", date: "2분 전" },
    { id: "RUN-0041", type: "평가", target: "RUN-0040 데이터셋", model: "Gemini 3.1", status: "completed", items: 150, time: "45초", date: "1시간 전" },
    { id: "RUN-0040", type: "생성", target: "고객지원 > 멤버십", model: "GPT-4o", status: "failed", items: 0, time: "12초", date: "3시간 전" },
    { id: "RUN-0039", type: "생성", target: "상품 > 인터넷", model: "GPT-5.1", status: "completed", items: 500, time: "5분 30초", date: "어제" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* 1. Key Metrics */}
      <StatsGrid />

      {/* 2. Recent Pipeline Runs & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">최근 파이프라인 실행</h3>
              <p className="text-sm text-slate-500">최근 생성 및 평가 작업 내역</p>
            </div>
            <button className="text-sm font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
              전체 보기 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">작업 ID</th>
                  <th className="px-6 py-3 font-medium">유형</th>
                  <th className="px-6 py-3 font-medium">대상 / 데이터셋</th>
                  <th className="px-6 py-3 font-medium">상태</th>
                  <th className="px-6 py-3 font-medium text-right">항목 수</th>
                  <th className="px-6 py-3 font-medium text-right">시간</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{run.id}</td>
                    <td className="px-6 py-4 font-medium text-slate-700">{run.type}</td>
                    <td className="px-6 py-4 text-slate-600 truncate max-w-[150px]">{run.target}</td>
                    <td className="px-6 py-4">
                      {run.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" /> 완료
                        </span>
                      ) : run.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 text-xs font-medium border border-rose-200">
                          <XCircle className="w-3.5 h-3.5" /> 실패
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
                          <Clock className="w-3.5 h-3.5" /> 진행 중
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-slate-700">{run.items}</td>
                    <td className="px-6 py-4 text-right text-slate-500">{run.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">빠른 실행</h3>
          <p className="text-sm text-slate-500 mb-6">새 작업을 시작하거나 모델을 관리하세요.</p>
          
          <div className="space-y-3 flex-1">
            <button 
              onClick={() => setActiveTab("generation")}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-all group text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                <Play className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-slate-800 group-hover:text-indigo-700">QA 생성 및 평가</div>
                <div className="text-xs text-slate-500">데이터 생성 파이프라인 실행</div>
              </div>
            </button>

            <button 
              onClick={() => setActiveTab("evaluation")}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-all group text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-slate-800 group-hover:text-emerald-700">평가 결과 확인</div>
                <div className="text-xs text-slate-500">품질 점수 및 상세 리포트 검토</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Charts & API Usage (부가 정보) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">QA 생성 추이</h3>
              <p className="text-sm text-slate-500">일별 QA 생성량</p>
            </div>
          </div>
          <ActivityChart />
        </div>

        <div className="space-y-8">
          {/* API Usage Card */}
          <div className="bg-indigo-600 rounded-xl p-6 text-white flex flex-col justify-between shadow-lg shadow-indigo-900/20 h-full">
            <div>
              <h3 className="text-xl font-bold mb-2">API 사용량 및 한도</h3>
              <p className="text-indigo-100 text-sm mb-6">이번 결제 주기의 전체 모델 토큰 사용량입니다.</p>
              
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1 font-medium">
                    <span>GPT-5.1</span>
                    <span>4.5M / 10M</span>
                  </div>
                  <div className="w-full bg-indigo-900/50 rounded-full h-2">
                    <div className="bg-white h-2 rounded-full" style={{ width: '45%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1 font-medium">
                    <span>Gemini 3.1 Flash Lite</span>
                    <span>1.2M / 5M</span>
                  </div>
                  <div className="w-full bg-indigo-900/50 rounded-full h-2">
                    <div className="bg-emerald-400 h-2 rounded-full" style={{ width: '24%' }}></div>
                  </div>
                </div>
              </div>
            </div>
            
            <button className="w-full py-3 bg-white text-indigo-600 rounded-lg font-semibold text-sm hover:bg-indigo-50 transition-colors mt-8">
              결제 상세 보기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
