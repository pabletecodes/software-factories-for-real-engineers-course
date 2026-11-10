// PROTOTYPE: floating variant switcher for throwaway UI prototypes. Never ship.
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PrototypeSwitcherProps {
  variants: { key: string; name: string }[];
  current: string;
  children?: React.ReactNode;
}

export function PrototypeSwitcher({
  variants,
  current,
  children,
}: PrototypeSwitcherProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams);
    params.set("variant", next.key);
    setSearchParams(params, { replace: true, preventScrollReset: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-dashed border-fuchsia-500 bg-zinc-900 px-2 py-1.5 text-sm text-white shadow-2xl">
      <button
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/15"
        title="Previous variant (←)"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-48 text-center font-medium">
        {variants[index].key} ({variants[index].name})
      </span>
      <button
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/15"
        title="Next variant (→)"
      >
        <ChevronRight className="size-4" />
      </button>
      {children}
    </div>
  );
}
