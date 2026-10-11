import { useState } from "react";

export default function Flag({ code, className = "" }: { code: string | null | undefined; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!code || code.length !== 2) return <span className={`text-slate-600 ${className}`}>🌐</span>;
  const cc = code.toLowerCase();
  if (failed) return <span className={`rounded bg-base-800 px-1 text-[10px] font-semibold text-slate-300 ${className}`}>{code.toUpperCase()}</span>;
  return (
    <img src={`https://flagcdn.com/20x15/${cc}.png`} srcSet={`https://flagcdn.com/40x30/${cc}.png 2x`} width={20} height={15}
      alt={code.toUpperCase()} title={code.toUpperCase()} loading="lazy" onError={() => setFailed(true)}
      className={`inline-block rounded-[2px] align-[-2px] shadow ${className}`} />
  );
}
