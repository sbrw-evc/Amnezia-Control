import { useEffect } from "react";

type Handler = (data: any) => void;

export class LiveChannel {
  private source: EventSource | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private statusHandlers = new Set<(connected: boolean) => void>();

  connect() {
    if (this.source) return;
    this.source = new EventSource("/api/events", { withCredentials: true });
    this.source.onopen = () => this.statusHandlers.forEach((h) => h(true));
    this.source.onerror = () => this.statusHandlers.forEach((h) => h(false));
    for (const ev of this.handlers.keys()) this.bind(ev);
  }

  disconnect() {
    this.source?.close();
    this.source = null;
  }

  private bind(event: string) {
    this.source?.addEventListener(event, (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      this.handlers.get(event)?.forEach((h) => h(data));
    });
  }

  on(event: string, h: Handler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
      this.bind(event);
    }
    this.handlers.get(event)!.add(h);
    return () => this.handlers.get(event)?.delete(h);
  }

  onStatus(h: (connected: boolean) => void): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }
}

export const live = new LiveChannel();

export function useLive(event: string, handler: Handler, deps: unknown[] = []) {
  useEffect(() => live.on(event, handler), deps);
}
