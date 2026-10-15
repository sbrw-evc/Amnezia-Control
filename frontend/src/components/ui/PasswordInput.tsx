import { t } from "@/i18n";
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState, type InputHTMLAttributes } from "react";
import clsx from "clsx";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput({ className, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative w-full min-w-0">
      <input ref={ref} {...props} type={visible ? "text" : "password"} className={clsx("input pr-10", className)} />
      <button type="button" tabIndex={-1} onClick={() => setVisible((v) => !v)}
        title={visible ? t("Hide") : t("Show")} aria-label={visible ? t("Hide the password") : t("Show the password")}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 transition hover:text-slate-200">
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
});

export default PasswordInput;
