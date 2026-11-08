'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface ModelSelectProps {
  id: string;
  label: string;
  description: string;
  value: string;
  defaultValue: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ModelSelect({
  id, label, description, value, defaultValue, options, onChange, disabled,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedIndex = options.findIndex(option => option.value === value);
  const selected = options[selectedIndex];
  const expanded = open && !disabled;

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [expanded]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function showOptions() {
    setActiveIndex(Math.max(selectedIndex, 0));
    setOpen(true);
  }

  function choose(index: number) {
    if (disabled || !options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!expanded) showOptions();
        else setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
        break;
      case 'Home':
      case 'End':
        if (!expanded) return;
        event.preventDefault();
        setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (expanded) choose(activeIndex);
        else showOptions();
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={root} className="min-w-0 space-y-2">
      <label id={`${id}-label`} htmlFor={id} className="text-xs font-semibold text-slate-400 dark:text-slate-500">
        {label}
      </label>
      <div className="relative">
        <button
          ref={trigger}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={expanded}
          aria-haspopup="listbox"
          aria-controls={`${id}-options`}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-describedby={`${id}-description`}
          aria-activedescendant={expanded ? `${id}-option-${activeIndex}` : undefined}
          disabled={disabled}
          onClick={() => expanded ? setOpen(false) : showOptions()}
          onKeyDown={handleKeyDown}
          onBlur={event => {
            if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
          className={cn(
            'flex min-h-12 w-full items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-left text-sm transition-all duration-150',
            'bg-white/80 text-slate-700 shadow-sm shadow-slate-200/20 dark:bg-white/5 dark:text-slate-100 dark:shadow-black/10',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/10',
            expanded ? 'border-indigo-300 ring-4 ring-indigo-500/5 dark:border-indigo-400/50' : 'border-slate-200/80 dark:border-white/10',
            disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-indigo-300 hover:bg-white dark:hover:border-indigo-400/40 dark:hover:bg-white/8',
          )}
        >
          <span id={`${id}-value`} className="min-w-0 flex-1 truncate font-medium">{selected?.label}</span>
          {value === defaultValue && (
            <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">기본</span>
          )}
          <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150', expanded && 'rotate-180')} />
        </button>

        {expanded && (
          <ul
            id={`${id}-options`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className="absolute left-0 right-0 z-50 mt-2 space-y-1 rounded-2xl border border-slate-200/70 bg-white/95 p-1.5 shadow-xl shadow-slate-300/20 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95 dark:shadow-black/30"
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                onPointerMove={() => setActiveIndex(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => choose(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-xl px-3 py-3 text-sm transition-colors duration-100',
                  option.value === value ? 'font-medium text-indigo-700 dark:text-indigo-200' : 'text-slate-600 dark:text-slate-300',
                  index === activeIndex && 'bg-indigo-50/80 dark:bg-indigo-400/10',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === defaultValue && <span className="text-[10px] text-slate-400 dark:text-slate-500">기본</span>}
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {option.value === value && <Check aria-hidden="true" className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p id={`${id}-description`} className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
  );
}
