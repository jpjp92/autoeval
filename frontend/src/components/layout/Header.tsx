import { Sun, Moon, Bell, CheckCircle2, XCircle, Info } from "lucide-react";
import { useState, useRef, useEffect } from "react";

import React from "react";

export interface Notification {
  id: string;
  title: string;
  sub?: string;
  type: 'success' | 'error' | 'info';
  time: Date;
  read: boolean;
}

interface HeaderProps {
  title: string;
  icon?: React.ElementType;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  onProfileClick: () => void;
  notifications: Notification[];
  onClearAll: () => void;
  onMarkAllRead: () => void;
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

const typeConfig = {
  success: { icon: CheckCircle2, color: 'text-emerald-500 dark:text-emerald-400' },
  error:   { icon: XCircle,       color: 'text-red-500 dark:text-red-400'         },
  info:    { icon: Info,           color: 'text-indigo-500 dark:text-indigo-400'   },
};

export function Header({ title, icon: Icon, theme, setTheme, notifications, onClearAll, onMarkAllRead }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = notifications.filter(n => !n.read).length;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleBellClick() {
    const next = !open;
    setOpen(next);
    if (next) onMarkAllRead();
  }

  return (
    <header className="mx-3 mt-3 mb-1 sticky top-3 z-40">
      <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl rounded-full border border-white/60 dark:border-white/8 shadow-[0_8px_40px_-12px_rgba(99,102,241,0.12)] dark:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.5)] flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-indigo-500/70 dark:text-indigo-400/80 shrink-0" />}
          <h1 className="text-lg font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500 dark:from-indigo-400 dark:to-purple-400">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-2">

          {/* Notification Bell */}
          <div className="relative" ref={ref}>
            <button
              onClick={handleBellClick}
              className="relative p-2.5 text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors flex items-center justify-center"
              title="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unread > 0 && (
                <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-indigo-500 rounded-full ring-2 ring-white dark:ring-slate-800" />
              )}
            </button>

            {open && (
              <div className="absolute right-0 top-full mt-2 w-80 z-[9999] bg-white dark:bg-slate-800 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl shadow-slate-300/50 dark:shadow-black/80 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-white/8">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Notifications</span>
                  {notifications.length > 0 && (
                    <button
                      onClick={onClearAll}
                      className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                      전체 삭제
                    </button>
                  )}
                </div>

                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500">
                      <Bell className="w-7 h-7 mb-2 opacity-25" />
                      <p className="text-sm">알림이 없습니다</p>
                    </div>
                  ) : (
                    notifications.map((n, i) => {
                      const { icon: Icon, color } = typeConfig[n.type];
                      return (
                        <div
                          key={n.id}
                          className={[
                            "flex gap-3 px-4 py-3",
                            i < notifications.length - 1 ? "border-b border-slate-100 dark:border-white/5" : "",
                            !n.read ? "bg-indigo-50/50 dark:bg-indigo-500/5" : "",
                          ].join(" ")}
                        >
                          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{n.title}</p>
                            {n.sub && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{n.sub}</p>
                            )}
                          </div>
                          <span
                            className="text-xs text-slate-400 dark:text-slate-500 shrink-0 mt-0.5"
                            title={n.time.toLocaleString('ko-KR')}
                          >
                            {relativeTime(n.time)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700/50 mx-1"></div>

          {/* Dark / Light toggle */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all duration-200 opacity-80 hover:opacity-100"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
          </button>

        </div>
      </div>
    </header>
  );
}
