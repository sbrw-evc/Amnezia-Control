import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, ListChecks, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { api } from "@/lib/api";
import type { Onboarding, OnboardingStep } from "@/lib/types";
import { t } from "@/i18n";
import { CHECKLIST, GUIDES, type StepText } from "./texts";

/** A step done with a button of the page itself (a dialog, an upload, a synchronization); the page passes what each does. */
export type GuideAction = "create" | "discover" | "upload" | "sync";
export type GuideActions = Partial<Record<GuideAction, () => void>>;

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-base-800" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(done / Math.max(total, 1)) * 100}%` }} />
    </div>
  );
}

function counts(data: Onboarding) {
  const required = data.steps.filter((s) => !s.optional);
  return { done: required.filter((s) => s.done).length, total: required.length };
}

/** One step: the mark (a tick or its number), its name and text, and on the right its button, "Done" or "Ask an administrator". */
function StepRow({ n, step: s, text, current, action }: { n: number; step: OnboardingStep; text: StepText; current: boolean; action?: () => void }) {
  const btn = current ? "btn-primary btn-sm" : "btn-ghost btn-sm";
  let right: ReactNode = null;
  if (s.done) right = <span className="pill bg-emerald-500/15 text-emerald-300">{t("Done")}</span>;
  else if (!s.can_fix) right = <span className="text-xs text-slate-500" title={t("Only a role with more rights can do this step")}>{t("Ask an administrator")}</span>;
  else if (text.go && action) right = <button type="button" className={btn} onClick={action}>{t(text.go)} <ChevronRight size={14} /></button>;
  else if (text.go && s.path) right = <Link to={s.path} className={btn}>{t(text.go)} <ChevronRight size={14} /></Link>;
  return (
    <li className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 border-t border-base-700 py-3 first:border-0 sm:grid-cols-[auto_1fr_auto]" aria-current={current ? "step" : undefined}>
      {s.done ? <CheckCircle2 size={22} className="text-emerald-400" aria-hidden />
        : <span className={clsx("grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] text-[11px] font-semibold",
            current ? "border-accent bg-accent text-white" : "border-base-600 text-slate-500")} aria-hidden>{n}</span>}
      <div className="min-w-0">
        <div className={clsx("flex flex-wrap items-center gap-2 text-sm font-semibold", s.done ? "text-slate-500" : current ? "text-accent" : "text-slate-100")}>
          {t(text.title)}
          {s.optional && <span className="pill bg-base-800 font-normal text-slate-400">{t("Optional")}</span>}
        </div>
        {!s.done && <div className="mt-0.5 text-[13px] leading-snug text-slate-400">{t(text.text)}</div>}
      </div>
      {right && <div className="col-start-2 sm:col-start-auto sm:text-right">{right}</div>}
    </li>
  );
}

function Steps({ data, texts, actions = {} }: { data: Onboarding; texts: Record<string, StepText>; actions?: GuideActions }) {
  const current = data.steps.find((s) => !s.done && !s.optional)?.id;
  return (
    <ol className="list-none">
      {data.steps.filter((s) => texts[s.id]).map((s, i) => (
        <StepRow key={s.id} n={i + 1} step={s} text={texts[s.id]} current={s.id === current}
          action={s.action ? actions[s.action as GuideAction] : undefined} />
      ))}
    </ol>
  );
}

/** The "First steps" checklist of the overview page: from installation to a network the panel watches and reports on.
 * It is hidden while loading, when it cannot be read and once every required step is done. */
export function FirstSteps() {
  const q = useQuery({ queryKey: ["onboarding"], queryFn: () => api.onboarding.checklist() });
  if (!q.data || q.data.done) return null;
  const { done, total } = counts(q.data);
  return (
    <section className="card space-y-3 p-[18px]" aria-labelledby="first-steps">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ListChecks size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div>
            <h2 id="first-steps" className="text-[15px] font-semibold text-slate-100">{t("First steps")}</h2>
            <p className="mt-0.5 max-w-[75ch] text-[13px] text-slate-400">{t("From installation to a network the panel watches and reports on. The steps are ticked off on their own as soon as they are done.")}</p>
          </div>
        </div>
        <span className="pill bg-amber-500/15 text-amber-300">{t("{done} of {total} done", { done, total })}</span>
      </div>
      <Progress done={done} total={total} />
      <Steps data={q.data} texts={CHECKLIST} />
    </section>
  );
}

const foldKey = (page: string) => `nc.guide.${page}`;

function savedFolded(page: string) {
  try {
    return localStorage.getItem(foldKey(page)) === "1";
  } catch {
    return false;
  }
}

/** The step-by-step setup guide of a page, in the style of the checklist: what to do, in order, for the page to be of
 * use. The current step is marked; the guide folds to one line and hides once every required step is done. */
export function SetupGuide({ page, actions }: { page: keyof typeof GUIDES; actions?: GuideActions }) {
  const q = useQuery({ queryKey: ["guide", page], queryFn: () => api.onboarding.guide(page) });
  const [folded, setFolded] = useState(() => savedFolded(page));
  const guide = GUIDES[page];
  if (!q.data || q.data.done || !guide) return null;
  const { done, total } = counts(q.data);
  const toggle = () => {
    setFolded(!folded);
    try {
      localStorage.setItem(foldKey(page), folded ? "0" : "1");
    } catch {
      /* the choice is not remembered */
    }
  };
  const id = `guide-${page}`;
  const head = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <Wand2 size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <h2 id={id} className="text-[15px] font-semibold text-slate-100">{t("Setup guide")}</h2>
          {!folded && <p className="mt-0.5 max-w-[75ch] text-[13px] text-slate-400">{t(guide.intro)}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="pill bg-amber-500/15 text-amber-300">{t("{done} of {total} done", { done, total })}</span>
        <button type="button" className="btn-ghost btn-sm" onClick={toggle} aria-expanded={!folded} aria-controls={`${id}-steps`}>
          {folded ? <>{t("Expand")} <ChevronDown size={14} /></> : <>{t("Collapse")} <ChevronUp size={14} /></>}
        </button>
      </div>
    </div>
  );
  return (
    <section className={clsx("card", folded ? "px-[18px] py-3" : "space-y-3 p-[18px]")} aria-labelledby={id}>
      {head}
      {!folded && <div id={`${id}-steps`} className="space-y-3"><Progress done={done} total={total} /><Steps data={q.data} texts={guide.steps} actions={actions} /></div>}
    </section>
  );
}
