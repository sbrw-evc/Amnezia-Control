import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import { ApiError } from "./lib/api";
import { notify } from "./lib/notify";
import "./index.css";

function reportQueryError(error: Error) {
  if (error instanceof ApiError && error.status === 401) return;
  notify.error("Не удалось загрузить данные", error.message, 60_000);
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportQueryError }),
  mutationCache: new MutationCache(),
  defaultOptions: { queries: { staleTime: 5_000, refetchInterval: 30_000, refetchOnWindowFocus: true, refetchOnReconnect: true, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster theme="dark" position="bottom-right" visibleToasts={5} expand closeButton richColors gap={10} offset={20}
        toastOptions={{ style: { background: "#131c31", border: "1px solid #243049" } }} />
    </QueryClientProvider>
  </React.StrictMode>,
);
