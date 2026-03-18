import { Bell } from "lucide-react";

export function Header({ title }: { title: string }) {
  return (
    <header className="h-16 bg-white/70 backdrop-blur-md border-b border-slate-200/50 flex items-center justify-between px-8 sticky top-0 z-10">
      <h1 className="text-xl font-semibold text-slate-800">{title}</h1>

      <div className="flex items-center gap-4">
        <button className="relative p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
        </button>
      </div>
    </header>
  );
}
