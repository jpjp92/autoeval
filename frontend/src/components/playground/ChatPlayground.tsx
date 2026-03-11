import { useState } from "react";
import { Send, User, Bot, RefreshCw, Settings2, FileText, ChevronDown, ChevronUp, Activity } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  context?: string;
  metrics?: {
    relevance: number;
    groundedness: number;
    clarity: number;
  };
}

export function ChatPlayground() {
  const [input, setInput] = useState("");
  const [expandedContext, setExpandedContext] = useState<string | null>(null);
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "안녕하세요! 생성된 QA 데이터셋과 RAG 파이프라인을 테스트할 수 있는 플레이그라운드입니다. 질문을 입력하시면 검색된 컨텍스트와 함께 RAG Triad 평가 점수를 실시간으로 보여드립니다.",
      timestamp: new Date()
    },
    {
      id: "2",
      role: "user",
      content: "KT 5G 요금제 중 데이터 무제한인 상품은 무엇인가요?",
      timestamp: new Date()
    },
    {
      id: "3",
      role: "assistant",
      content: "KT 5G 요금제 중 데이터를 무제한으로 제공하는 상품은 '5G 슈퍼플랜' 요금제입니다. 이 요금제는 속도 제한 없이 5G 데이터를 무제한으로 이용할 수 있으며, 베이직, 스페셜, 프리미엄 등급으로 나뉘어 혜택이 다르게 제공됩니다.",
      context: "[문서 ID: doc_5g_plans_001]\nKT 5G 슈퍼플랜 요금제 안내\n- 5G 슈퍼플랜은 데이터 완전 무제한을 제공하는 KT의 대표 5G 요금제입니다.\n- 요금제 종류: 슈퍼플랜 베이직 (월 80,000원), 슈퍼플랜 스페셜 (월 100,000원), 슈퍼플랜 프리미엄 (월 130,000원)\n- 공통 혜택: 5G 데이터 무제한 (속도 제어 없음), 음성/문자 기본 제공, 로밍 데이터 무제한 (최대 100kbps~3Mbps 속도 제어)",
      metrics: {
        relevance: 0.95,
        groundedness: 1.0,
        clarity: 0.92
      },
      timestamp: new Date()
    }
  ]);
  const [isTyping, setIsTyping] = useState(false);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Simulate RAG response and Evaluation
    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "가족 결합 할인을 받으시려면 가까운 KT 대리점을 방문하시거나 고객센터(114)를 통해 신청하실 수 있습니다. 신청 시 가족 관계 증명서와 신분증이 필요합니다.",
        context: "[문서 ID: doc_family_discount_002]\nKT 가족 결합 할인 신청 방법\n1. 구비 서류: 가족관계증명서 (발급일 3개월 이내), 명의자 신분증\n2. 신청 채널: KT 플라자/대리점 방문, 고객센터(휴대폰 114) 전화 신청\n3. 유의사항: 결합 대상 가족의 동의가 필요하며, 요금제에 따라 할인율이 상이할 수 있습니다.",
        metrics: {
          relevance: 0.88,
          groundedness: 0.95,
          clarity: 0.85
        },
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMsg]);
      setIsTyping(false);
    }, 2000);
  };

  const toggleContext = (id: string) => {
    setExpandedContext(expandedContext === id ? null : id);
  };

  return (
    <div className="flex h-[calc(100vh-140px)] gap-6 animate-in fade-in duration-500">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="font-medium text-slate-700">RAG QA Testing Pipeline</span>
          </div>
          <button 
            onClick={() => setMessages([messages[0]])}
            className="text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-2 text-sm font-medium"
            title="Clear Chat"
          >
            <RefreshCw className="w-4 h-4" /> Reset Session
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/50">
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={cn(
                "flex gap-4 max-w-4xl",
                msg.role === "user" ? "ml-auto flex-row-reverse" : ""
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1",
                msg.role === "user" ? "bg-indigo-100 text-indigo-600" : "bg-emerald-100 text-emerald-600"
              )}>
                {msg.role === "user" ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
              </div>
              
              <div className="flex flex-col gap-2 max-w-2xl">
                <div className={cn(
                  "p-4 rounded-2xl text-sm leading-relaxed shadow-sm",
                  msg.role === "user" 
                    ? "bg-indigo-600 text-white rounded-tr-none" 
                    : "bg-white text-slate-700 border border-slate-200 rounded-tl-none"
                )}>
                  {msg.content}
                </div>

                {/* RAG Context & Metrics (Only for Assistant) */}
                {msg.role === "assistant" && msg.context && msg.metrics && (
                  <div className="mt-1 space-y-2">
                    {/* Metrics Badges */}
                    <div className="flex gap-2">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-medium text-slate-600 shadow-sm">
                        <Activity className="w-3 h-3 text-indigo-500" />
                        Relevance: <span className={msg.metrics.relevance >= 0.8 ? "text-emerald-600" : "text-amber-600"}>{msg.metrics.relevance.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-medium text-slate-600 shadow-sm">
                        <Activity className="w-3 h-3 text-indigo-500" />
                        Groundedness: <span className={msg.metrics.groundedness >= 0.8 ? "text-emerald-600" : "text-amber-600"}>{msg.metrics.groundedness.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-medium text-slate-600 shadow-sm">
                        <Activity className="w-3 h-3 text-indigo-500" />
                        Clarity: <span className={msg.metrics.clarity >= 0.8 ? "text-emerald-600" : "text-amber-600"}>{msg.metrics.clarity.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Context Accordion */}
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                      <button 
                        onClick={() => toggleContext(msg.id)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-xs font-medium text-slate-600"
                      >
                        <span className="flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5" />
                          View Retrieved Context
                        </span>
                        {expandedContext === msg.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      {expandedContext === msg.id && (
                        <div className="p-3 text-xs text-slate-600 bg-white border-t border-slate-100 whitespace-pre-wrap font-mono leading-relaxed">
                          {msg.context}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="flex gap-4 max-w-3xl">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-5 h-5" />
              </div>
              <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1 h-[52px]">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-75"></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-150"></span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-white border-t border-slate-200">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask a question to test the RAG pipeline..."
              className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className="px-5 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium text-sm shadow-sm"
            >
              <Send className="w-4 h-4" />
              Test QA
            </button>
          </div>
        </div>
      </div>

      {/* Configuration Sidebar */}
      <div className="w-80 bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-6">
        <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
          <Settings2 className="w-5 h-5 text-slate-500" />
          <h3 className="font-semibold text-slate-800">Pipeline Config</h3>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Generator Model</label>
            <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none">
              <option>Gemini 3.1 Flash-Lite</option>
              <option>GPT-5.1</option>
              <option>Claude Sonnet 4.5</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Evaluator (Judge)</label>
            <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none">
              <option>TruLens RAG Triad (Gemini 2.5 Flash)</option>
              <option>품질 평가기 (GPT-5.1)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Retrieval Top-K</label>
            <div className="flex items-center gap-4">
              <input type="range" min="1" max="10" step="1" defaultValue="3" className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
              <span className="text-sm font-mono text-slate-600 w-8 text-right">3</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">System Prompt</label>
            <textarea 
              className="w-full h-32 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none resize-none font-mono text-xs"
              defaultValue="You are a QA dataset generation expert for Korea telecom (KT) customer support. Generate questions and answers based ONLY on the provided context."
            ></textarea>
          </div>
        </div>

        <div className="mt-auto pt-4 border-t border-slate-100">
          <button className="w-full py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm">
            Apply Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
