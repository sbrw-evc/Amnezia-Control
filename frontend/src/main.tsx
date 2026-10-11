import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({

  defaultOptions: { queries: { staleTime: 5_000, refetchInterval: 30_000, refetchOnWindowFocus: true, refetchOnReconnect: true, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster theme="dark" position="bottom-right" richColors closeButton
        toastOptions={{ style: { background: "#131c31", border: "1px solid #243049" } }} />
    </QueryClientProvider>
  </React.StrictMode>,
);
