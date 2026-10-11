import { motion, AnimatePresence, useAnimationControls } from "framer-motion";
import { notify } from "@/lib/notify";
import PasswordInput from "@/components/ui/PasswordInput";
import { Activity, KeyRound, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";

export default function LoginPage() {
  const { user, ready, setUser } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "totp">("password");
  const [busy, setBusy] = useState(false);
  const shake = useAnimationControls();

  if (ready && user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (step === "password") {
        const r = await api.auth.login(username.trim(), password);
        if (r.requires_2fa) { setStep("totp"); return; }
        setUser(r.user);
      } else {
        const r = await api.auth.verify2fa(code);
        setUser(r.user);
      }
      nav(from, { replace: true });
    } catch (err) {
      notify.error("Не удалось войти", err instanceof Error ? err.message : "Ошибка входа");
      shake.start({ x: [0, -10, 10, -6, 6, 0], transition: { duration: 0.4 } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <motion.div className="absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-blue-600/20 blur-3xl"
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }} transition={{ duration: 14, repeat: Infinity }} />
      <motion.div className="absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-indigo-600/20 blur-3xl"
        animate={{ x: [0, -50, 0], y: [0, -30, 0] }} transition={{ duration: 16, repeat: Infinity }} />

      <motion.div animate={shake} className="relative w-full max-w-sm">
      <motion.form onSubmit={submit} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }} className="card relative w-full p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-glow">
            <Activity className="text-white" size={22} />
          </div>
          <div>
            <div className="text-lg font-semibold text-white">Amnezia Control</div>
            <div className="text-xs text-slate-400">Панель управления VPN</div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {step === "password" ? (
            <motion.div key="pw" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-3">
              <div>
                <label className="label" htmlFor="u">Логин</label>
                <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="p">Пароль</label>
                <PasswordInput id="p" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </motion.div>
          ) : (
            <motion.div key="totp" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-300"><ShieldCheck size={16} className="text-emerald-400" /> Введите код из приложения-аутентификатора</div>
              <input className="input text-center font-mono text-2xl tracking-[.5em]" inputMode="numeric" autoFocus maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </motion.div>
          )}
        </AnimatePresence>

        <button type="submit" className="btn-primary mt-5 w-full py-2.5" disabled={busy || (step === "password" ? !password : code.length < 6)}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : step === "password" ? <LogIn size={16} /> : <KeyRound size={16} />}
          {step === "password" ? "Войти" : "Подтвердить"}
        </button>
        {step === "totp" && (
          <button type="button" className="mt-2 w-full text-xs text-slate-500 hover:text-slate-300" onClick={() => { setStep("password"); setCode(""); }}>
            ← Назад
          </button>
        )}
      </motion.form>
      </motion.div>
    </div>
  );
}
