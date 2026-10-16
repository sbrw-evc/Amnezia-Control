import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Router, Save, Users, Wrench } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { copyText, useAction } from "@/lib/hooks";
import { useAuth } from "@/store/auth";
import { Badge, Card, Field, Page, PageHeader } from "@/components/ui/Primitives";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { confirm } from "@/components/ui/Confirm";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-slate-500">{label}</span><span className="text-right">{children}</span></div>;
}

export default function MikrotikVpn() {
  const isAdmin = useAuth((s) => s.can("admin"));
  const info = useQuery({ queryKey: ["mikrotik-vpn"], queryFn: () => api.ops.mikrotikVpn(), refetchInterval: 30_000 });
  const setup = useAction(() => api.ops.setupMikrotikVpn(), {
    success: "WireGuard на MikroTik настроен", invalidate: [["mikrotik-vpn"], ["vpn-servers"], ["routing"]],
  });
  const [host, setHost] = useState("");
  const [dns, setDns] = useState("");
  const [allowed, setAllowed] = useState("");
  const i = info.data;
  useEffect(() => { if (i) { setHost(i.endpoint_host); setDns(i.client_dns); setAllowed(i.allowed_ips); } }, [i?.endpoint_host, i?.client_dns, i?.allowed_ips]);
  const save = useAction(() => api.ops.saveSettings({ mt_endpoint_host: host.trim(), mt_client_dns: dns.trim(), mt_allowed_ips: allowed.trim() || "0.0.0.0/0" }), {
    success: "Параметры клиентов сохранены — новые конфиги будут выдаваться с ними", invalidate: [["mikrotik-vpn"], ["settings"]],
  });
  const presets = i ? [
    { label: "Весь трафик", value: "0.0.0.0/0" },
    { label: "Только домашняя сеть", value: `${i.lan_cidr}, ${i.network}` },
  ] : [];
  const runSetup = async () => {
    if (await confirm({
      title: i?.configured ? "Повторить настройку?" : "Настроить WireGuard на MikroTik?",
      message: "Будут созданы (если их нет) интерфейс WireGuard, адрес, правила firewall для порта и DNS, а также правила mangle, чтобы сайты из списка шли через Amnezia. Существующие правила не изменяются.",
      confirmLabel: "Настроить",
    })) setup.mutate(undefined);
  };

  return (
    <Page>
      <PageHeader title="VPN на MikroTik" icon={<Router size={20} />}
        subtitle="WireGuard-сервер на домашнем роутере: клиенты управляются вместе с клиентами Amnezia"
        actions={<>
          <Link to="/clients" className="btn-ghost"><Users size={16} /> Клиенты</Link>
          {isAdmin && <button className={i?.configured ? "btn-ghost" : "btn-primary"} disabled={setup.isPending} onClick={runSetup}>
            <Wrench size={16} /> {i?.configured ? "Повторить настройку" : "Настроить на MikroTik"}
          </button>}
        </>} />
      {info.error && <ErrorState error={info.error} />}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Интерфейс">
          {i ? (
            <div className="space-y-2 text-sm">
              <Row label="Состояние">
                {!i.configured ? <Badge tone="amber">не настроен</Badge> : i.running ? <Badge tone="green">работает</Badge> : <Badge tone="red">остановлен</Badge>}
              </Row>
              <Row label="Интерфейс"><span className="mono">{i.interface}</span></Row>
              <Row label="Порт"><span className="mono">{i.port}/udp</span></Row>
              <Row label="Сеть клиентов"><span className="mono">{i.network}</span></Row>
              <Row label="Адрес роутера"><span className="mono">{i.server_ip}</span></Row>
              <Row label="Публичный адрес"><span className="mono">{i.public_address || "—"}</span></Row>
              <Row label="Пиров">{i.peers_total} <span className="text-slate-500">({i.peers_disabled} заблок.)</span></Row>
              {i.public_key && <>
                <div className="pt-2 text-slate-500">Публичный ключ</div>
                <button className="mono break-all text-left text-[11px] text-slate-300 hover:text-white" title="Скопировать" onClick={() => copyText(i.public_key!)}>{i.public_key}</button>
              </>}
            </div>
          ) : <Skeleton className="h-56" />}
        </Card>

        <Card className="xl:col-span-2" title="Параметры клиентских конфигов">
          {i ? (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Адрес подключения" hint={`пусто — публичный IP роутера (${i.public_address || "не определён"}); можно указать домен`}>
                  <input className="input mono" value={host} disabled={!isAdmin} onChange={(e) => setHost(e.target.value)} placeholder={i.public_address} />
                </Field>
                <Field label="DNS" hint={`пусто — DNS роутера (${i.server_ip})`}>
                  <input className="input mono" value={dns} disabled={!isAdmin} onChange={(e) => setDns(e.target.value)} placeholder={i.server_ip} />
                </Field>
              </div>
              <Field label="AllowedIPs" hint="что клиент отправляет в туннель; изменения действуют для заново скачанных конфигов">
                <div className="space-y-2">
                  <input className="input mono" value={allowed} disabled={!isAdmin} onChange={(e) => setAllowed(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    {presets.map((p) => (
                      <button type="button" key={p.label} disabled={!isAdmin} className={clsx("chip", allowed === p.value && "chip-on")} onClick={() => setAllowed(p.value)}>{p.label}</button>
                    ))}
                  </div>
                </div>
              </Field>
              {isAdmin && <div className="flex justify-end"><button className="btn-primary" disabled={save.isPending}><Save size={14} /> Сохранить</button></div>}
            </form>
          ) : <Skeleton className="h-56" />}
        </Card>
      </div>

      <Card title="Как это работает">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
          <li>Клиенты подключаются к домашнему роутеру по WireGuard на порт <span className="mono">{i?.port ?? 51820}/udp</span> и получают адрес из <span className="mono">{i?.network ?? "10.9.0.0/24"}</span>.</li>
          <li>Им доступна локальная сеть, а интернет идёт через провайдера; сайты из списка маршрутизации, как и у устройств в LAN, уходят через Amnezia.</li>
          <li>Создание, блокировка, квоты, сроки доступа, трафик, карта и ссылки на конфиг работают так же, как для клиентов Amnezia — на странице «Клиенты VPN» выберите сервер MikroTik.</li>
          <li>Конфиг — обычный WireGuard: импортируется в приложения WireGuard и Amnezia VPN (QR или файл .conf).</li>
          <li>Объекты на роутере помечены комментарием <span className="mono">amnezia</span>; откат описан в Wiki.</li>
        </ul>
      </Card>
    </Page>
  );
}
