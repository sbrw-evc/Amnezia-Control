import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

export function useAction<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, opts: {
  success?: string | ((r: TResult) => string);
  invalidate?: QueryKey[];
  onSuccess?: (r: TResult) => void;
} = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      opts.onSuccess?.(r);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export async function copyText(text: string, label = "Скопировано") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Буфер обмена недоступен (нужен HTTPS или localhost)");
  }
}
