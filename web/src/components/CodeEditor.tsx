import { useRef, useMemo, useCallback } from "react";
import { highlightWGSL } from "@/lib/wgsl-highlight";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function CodeEditor({ value, onChange, className = "" }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const highlighted = useMemo(() => highlightWGSL(value), [value]);

  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        const next = val.substring(0, start) + "  " + val.substring(end);
        onChange(next);
        // Restore cursor after React re-render
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [onChange],
  );

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <pre
        ref={preRef}
        className="absolute inset-0 overflow-auto pointer-events-none m-0 p-2 font-mono text-xs leading-[1.4] whitespace-pre text-foreground"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
      />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className="relative w-full h-full overflow-auto m-0 p-2 font-mono text-xs leading-[1.4] whitespace-pre bg-transparent text-transparent caret-foreground resize-none outline-none border-0"
      />
    </div>
  );
}
