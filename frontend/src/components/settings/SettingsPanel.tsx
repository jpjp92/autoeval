import { User, Key, Bell, Shield, Eye, EyeOff, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/src/lib/utils';
import { PipelineFlow } from './PipelineFlow';

const sections = [
  { id: 'profile',       label: 'Profile',       icon: User      },
  { id: 'api-keys',      label: 'API Keys',      icon: Key       },
  { id: 'pipeline',      label: 'Pipeline',      icon: GitBranch },
  { id: 'notifications', label: 'Notifications', icon: Bell      },
  // { id: 'security',      label: 'Security',      icon: Shield    },
];

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
    <div className="p-5 border border-slate-200 rounded-xl bg-slate-50/30">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="font-semibold text-slate-900 block text-sm">{label}</span>
          <span className="text-xs text-slate-500">{description}</span>
        </div>
        <span className={cn(
          "text-xs font-medium px-2.5 py-1 rounded-full border shrink-0 ml-4",
          value
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-slate-100 text-slate-500 border-slate-200"
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
            className="w-full px-4 py-2.5 pr-10 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono transition-all"
          />
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        환경 변수 <code className="bg-slate-100 px-1 rounded">{provider}</code> 에 저장됩니다. (현재 UI 구성만 제공)
      </p>
    </div>
  );
}

export function SettingsPanel() {
  const [activeSection, setActiveSection] = useState('profile');

  return (
    <div className="bg-white/60 backdrop-blur-sm overflow-hidden flex h-full border-t border-slate-200/40">
      {/* 좌측 내비 */}
      <div className="w-64 bg-slate-50/80 border-r border-slate-200/60 p-6 flex flex-col shrink-0">
        <nav className="space-y-1 flex-1">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                activeSection === s.id
                  ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              )}
            >
              <s.icon className="w-4 h-4 shrink-0" />
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 우측 콘텐츠 */}
      <div className="flex-1 p-8 overflow-y-auto">

        {/* Profile */}
        {activeSection === 'profile' && (
          <div className="max-w-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
            <h3 className="text-lg font-semibold text-slate-800 mb-1">Profile</h3>
            <p className="text-sm text-slate-500 mb-6">관리자 계정 정보입니다.</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">First Name</label>
                  <input
                    type="text"
                    defaultValue="Admin"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Last Name</label>
                  <input
                    type="text"
                    defaultValue="User"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Email</label>
                  <input
                    type="email"
                    defaultValue="admin@autoeval.ai"
                    readOnly
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-400 outline-none cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Auth 연동 예정 안내 */}
              <div className="mt-4 p-4 rounded-xl border border-indigo-100 bg-indigo-50/50">
                <p className="text-xs font-semibold text-indigo-700 mb-1">Auth 연동 예정</p>
                <p className="text-xs text-indigo-600 leading-relaxed">
                  향후 DB Auth 테이블과 연동하여 사용자별 프로필, 권한, 설정을 독립적으로 관리할 예정입니다.
                  현재는 단일 관리자 계정으로 운영됩니다.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* API Keys */}
        {activeSection === 'api-keys' && (
          <div className="max-w-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
            <h3 className="text-lg font-semibold text-slate-800 mb-1">API Keys</h3>
            <p className="text-sm text-slate-500 mb-6">
              각 LLM 프로바이더의 API 키를 관리합니다. 현재는 UI 구성 단계로, 실제 저장은 서버 환경 변수로 관리됩니다.
            </p>

            <div className="space-y-4">
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

            <div className="mt-5 p-4 rounded-xl border border-amber-100 bg-amber-50/50">
              <p className="text-xs font-semibold text-amber-700 mb-1">참고</p>
              <p className="text-xs text-amber-600 leading-relaxed">
                API 키는 현재 <code className="bg-amber-100 px-1 rounded">backend/.env</code> 파일에서 관리됩니다.
                향후 Auth 연동 시 사용자별 키 저장 및 암호화 저장 기능이 추가될 예정입니다.
              </p>
            </div>
          </div>
        )}

        {/* Pipeline Flow */}
        {activeSection === 'pipeline' && (
          <div className="h-full animate-in fade-in duration-300 -m-8">
            <div className="px-8 pt-8 pb-4">
              <h3 className="text-lg font-semibold text-slate-800 mb-1">Pipeline</h3>
              <p className="text-sm text-slate-500">전체 데이터 처리 파이프라인 구조입니다.</p>
            </div>
            <div style={{ height: 'calc(100% - 88px)' }}>
              <PipelineFlow />
            </div>
          </div>
        )}

        {/* 미구현 섹션 */}
        {activeSection !== 'profile' && activeSection !== 'api-keys' && activeSection !== 'pipeline' && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-in fade-in duration-300">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100">
              {(() => { const s = sections.find(s => s.id === activeSection); return s ? <s.icon className="w-6 h-6 text-slate-300" /> : null; })()}
            </div>
            <h3 className="text-base font-semibold text-slate-600 mb-2">
              {sections.find(s => s.id === activeSection)?.label}
            </h3>
            <p className="text-sm text-slate-400 text-center max-w-xs">
              향후 업데이트에서 제공될 예정입니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
