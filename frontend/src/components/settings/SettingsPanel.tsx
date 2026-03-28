import { User, Key, Eye, EyeOff, GitBranch } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/src/lib/utils';
import { PipelineFlow } from './PipelineFlow';

const sections = [
  { id: 'profile',   label: 'Profile',   icon: User      },
  { id: 'api-keys',  label: 'API Keys',  icon: Key       },
  { id: 'pipeline',  label: 'Pipeline',  icon: GitBranch },
];

const glassCard = "bg-white/60 dark:bg-white/5 backdrop-blur-sm rounded-2xl border border-white/60 dark:border-white/8 shadow-lg shadow-slate-200/30 dark:shadow-black/15 p-6";

interface ApiKeyRowProps {
  label: string;
  provider: string;
  placeholder: string;
  description: string;
}

function ApiKeyRow({ label, provider, placeholder, description }: ApiKeyRowProps) {
  const [show, setShow] = useState(false);
  const [value, setValue] = useState('');

  return (
    <div className="p-5 rounded-xl bg-white/50 dark:bg-white/5 border border-white/60 dark:border-white/8">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="font-semibold text-slate-900 dark:text-slate-100 block text-sm">{label}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{description}</span>
        </div>
        <span className={cn(
          "text-xs font-medium px-2.5 py-1 rounded-full border shrink-0 ml-4",
          value
            ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30"
            : "bg-slate-100 dark:bg-white/8 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10"
        )}>
          {value ? "입력됨" : "미설정"}
        </span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full px-4 py-2.5 pr-10 bg-white dark:bg-white/8 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500/30 font-mono transition-all"
          />
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
        환경 변수 <code className="bg-slate-100 dark:bg-white/10 px-1 rounded text-slate-600 dark:text-slate-300">{provider}</code> 에 저장됩니다. (현재 UI 구성만 제공)
      </p>
    </div>
  );
}

export function SettingsPanel({ section }: { section?: string } = {}) {
  const [activeSection, setActiveSection] = useState(section ?? 'profile');

  useEffect(() => {
    if (section) setActiveSection(section);
  }, [section]);

  const isPipeline = activeSection === 'pipeline';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Pill 탭 바 */}
      <div className="px-6 pt-5 pb-4 shrink-0">
        <div className="inline-flex items-center bg-black/5 dark:bg-white/8 rounded-2xl p-1 gap-0.5">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200",
                activeSection === s.id
                  ? "bg-white dark:bg-white/15 text-indigo-600 dark:text-indigo-300 shadow-sm shadow-black/5"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              )}
            >
              <s.icon className="w-3.5 h-3.5 shrink-0" />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className={cn("flex-1 overflow-y-auto", isPipeline ? "px-0" : "px-6 pb-6")}>

        {/* Profile */}
        {activeSection === 'profile' && (
          <div className="max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className={glassCard}>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-0.5">Profile</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">관리자 계정 정보입니다.</p>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">First Name</label>
                    <input
                      type="text"
                      defaultValue="Admin"
                      className="w-full px-3 py-2 bg-white dark:bg-white/8 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Last Name</label>
                    <input
                      type="text"
                      defaultValue="User"
                      className="w-full px-3 py-2 bg-white dark:bg-white/8 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Email</label>
                    <input
                      type="email"
                      defaultValue="admin@autoeval.ai"
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-xl text-sm text-slate-400 dark:text-slate-500 outline-none cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-500/10">
                  <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 mb-1">Auth 연동 예정</p>
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 leading-relaxed">
                    향후 DB Auth 테이블과 연동하여 사용자별 프로필, 권한, 설정을 독립적으로 관리할 예정입니다.
                    현재는 단일 관리자 계정으로 운영됩니다.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* API Keys */}
        {activeSection === 'api-keys' && (
          <div className="max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className={glassCard}>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-0.5">API Keys</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                각 LLM 프로바이더의 API 키를 관리합니다. 현재는 UI 구성 단계로, 실제 저장은 서버 환경 변수로 관리됩니다.
              </p>

              <div className="space-y-3">
                <ApiKeyRow
                  label="Google API Key"
                  provider="GOOGLE_API_KEY"
                  placeholder="AI..."
                  description="Gemini Embedding, Gemini Flash 생성 및 평가에 사용"
                />
                <ApiKeyRow
                  label="OpenAI API Key"
                  provider="OPENAI_API_KEY"
                  placeholder="sk-..."
                  description="GPT 계열 QA 생성 및 평가에 사용"
                />
                <ApiKeyRow
                  label="Anthropic API Key"
                  provider="ANTHROPIC_API_KEY"
                  placeholder="sk-..."
                  description="Claude 계열 QA 생성 및 평가에 사용"
                />
              </div>

              <div className="mt-4 p-4 rounded-xl border border-amber-100 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/10">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">참고</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                  API 키는 현재 <code className="bg-amber-100 dark:bg-amber-500/20 px-1 rounded">{`backend/.env`}</code> 파일에서 관리됩니다.
                  향후 Auth 연동 시 사용자별 키 저장 및 암호화 저장 기능이 추가될 예정입니다.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Pipeline Flow — 전체 높이 활용 */}
        {activeSection === 'pipeline' && (
          <div className="h-full flex flex-col animate-in fade-in duration-300">
            <div className="px-6 pb-3 shrink-0">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-0.5">Pipeline</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">전체 데이터 처리 파이프라인 구조입니다.</p>
            </div>
            <div className="flex-1 min-h-0">
              <PipelineFlow />
            </div>
          </div>
        )}

        {/* 미구현 섹션 */}
        {activeSection !== 'profile' && activeSection !== 'api-keys' && activeSection !== 'pipeline' && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 animate-in fade-in duration-300">
            <div className="w-16 h-16 bg-white/60 dark:bg-white/5 rounded-2xl flex items-center justify-center mb-4 border border-white/60 dark:border-white/8 shadow-sm">
              {(() => { const s = sections.find(s => s.id === activeSection); return s ? <s.icon className="w-6 h-6 text-slate-300 dark:text-slate-600" /> : null; })()}
            </div>
            <h3 className="text-base font-semibold text-slate-600 dark:text-slate-400 mb-2">
              {sections.find(s => s.id === activeSection)?.label}
            </h3>
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center max-w-xs">
              향후 업데이트에서 제공될 예정입니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
