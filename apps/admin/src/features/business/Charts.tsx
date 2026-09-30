import { useId, useState } from "react";
import { formatMoney } from "@vital-forge/ui-core";
import { monthNames, type MonthRow } from "./types";

export function TrendChart({ months, year, selected, onSelect }: { months: MonthRow[]; year: number; selected: number; onSelect: (month: number) => void }) {
  const [metric, setMetric] = useState<"revenue" | "result">("revenue");
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId().replace(/:/g, "");
  const today = new Date(Date.now() - 5 * 3600000);
  const future = (m: number) => year > today.getUTCFullYear() || year === today.getUTCFullYear() && m > today.getUTCMonth() + 1;
  const values = months.map(m => future(m.month) ? null : m[metric]);
  const finite = values.filter((v): v is number => v !== null);
  const max = Math.max(...finite, 1), min = Math.min(...finite, 0);
  const x = (i: number) => 64 + i * 49;
  const y = (v: number) => 190 - (v - min) / (max - min) * 156;
  const zero = y(0);
  let previous = false;
  const path = values.map((v, i) => { if (v === null) { previous = false; return ""; } const segment = `${previous ? "L" : "M"}${x(i)},${y(v)}`; previous = true; return segment; }).join(" ");
  const active = hover === null ? null : months[hover];
  return <div className="biz-trend">
    <div className="biz-chart-toolbar"><div className="biz-segments" role="group" aria-label="Indicador del gráfico"><button aria-pressed={metric === "revenue"} onClick={() => setMetric("revenue")}>Ventas</button><button aria-pressed={metric === "result"} onClick={() => setMetric("result")}>Resultado</button></div><span className="biz-chart-value" aria-live="polite">{active ? `${monthNames[active.month - 1]}: ${future(active.month) ? "Aún no transcurre" : active[metric] === null ? "Faltan costos" : formatMoney(active[metric]!)} ` : "Elige un mes para ver su detalle"}</span></div>
    <svg className="biz-line-chart" viewBox="0 0 640 236" role="img" aria-label={`${metric === "revenue" ? "Ventas" : "Resultado registrado"} mensual de ${year}; valores en los botones inferiores`}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d8ead3"/><stop offset="100%" stopColor="#f7faf6"/></linearGradient></defs>
      {[0, 0.5, 1].map(t => { const v = min + (max - min) * t; return <g key={t}><line x1="60" x2="620" y1={y(v)} y2={y(v)} stroke="#e4e9e3" strokeDasharray="4 5"/><text x="52" y={y(v) + 4} textAnchor="end" fill="#65716a" fontSize="12">${Math.round(v)}</text></g>; })}
      {values.every(v => v !== null) && <path d={`${path} L${x(11)},${zero} L${x(0)},${zero} Z`} fill={`url(#${gradient})`}/>}
      <line x1="60" x2="620" y1={zero} y2={zero} stroke="#c9d4c6"/>
      <path d={path} fill="none" stroke="#3b7356" strokeWidth="3" strokeLinejoin="round"/>
      {months.map((m, i) => <g key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
        {values[i] != null && <circle cx={x(i)} cy={y(values[i]!)} r={selected === m.month || hover === i ? 6 : 3.5} fill={values[i]! < 0 ? "#b84e42" : "#3b7356"} stroke="white" strokeWidth="2"/>}
        <text x={x(i)} y="223" textAnchor="middle" fill={selected === m.month ? "#234e38" : "#65716a"} fontSize="12" fontWeight={selected === m.month ? 700 : 400}>{monthNames[i]?.slice(0, 3)}</text>
      </g>)}
    </svg>
    <div className="biz-month-buttons">{months.map((m, i) => <button key={m.month} aria-pressed={selected === m.month} disabled={future(m.month)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSelect(m.month)} aria-label={`${monthNames[i]}: ${m[metric] === null ? "costos pendientes" : formatMoney(m[metric]!)}. Ver este mes.`}>{monthNames[i]?.slice(0, 3)}</button>)}</div>
    <p className="biz-caption">{metric === "result" ? "Ventas + envíos − costo de lo vendido − gastos. Los meses con costos pendientes quedan sin resultado." : "Ventas de productos de todo el año, sin envío. Pulsa un mes para actualizar el resumen."}</p>
  </div>;
}

export function HorizontalBar({ label, value, max, detail, color = "green", onClick }: { label: string; value: number; max: number; detail?: string; color?: "green" | "amber" | "red"; onClick?: () => void }) {
  const body = <><span className="biz-bar-label"><span>{label}</span><b>{formatMoney(value)}</b></span><span className="biz-bar-track"><span className={`biz-fill-${color}`} style={{ width: `${max > 0 ? Math.min(100, Math.abs(value) / max * 100) : 0}%` }}/></span>{detail && <small>{detail}</small>}</>;
  return onClick ? <button className="biz-horizontal-bar" onClick={onClick}>{body}</button> : <div className="biz-horizontal-bar">{body}</div>;
}

export function StockRing({ healthy, low, empty }: { healthy: number; low: number; empty: number }) {
  const total = healthy + low + empty;
  const values = [{ count: healthy, label: "Con stock suficiente", color: "#508568" }, { count: low, label: "Por reponer", color: "#d3a355" }, { count: empty, label: "Agotadas", color: "#c27366" }];
  let offset = 0;
  return <div className="biz-stock-ring"><svg viewBox="0 0 140 140" role="img" aria-label={`${healthy} variantes con stock suficiente, ${low} por reponer y ${empty} agotadas`}><circle cx="70" cy="70" r="52" fill="none" stroke="#edf0e9" strokeWidth="15"/>{values.map(v => { const length = total ? v.count / total * 326.73 : 0; const start = offset; offset += length; return <circle key={v.label} cx="70" cy="70" r="52" fill="none" stroke={v.color} strokeWidth="15" strokeDasharray={`${length} ${326.73 - length}`} strokeDashoffset={-start} transform="rotate(-90 70 70)"/>; })}<text x="70" y="69" textAnchor="middle" fill="#253d30" fontSize="27" fontWeight="600">{total}</text><text x="70" y="88" textAnchor="middle" fill="#65716a" fontSize="12">variantes</text></svg><div>{values.map(v => <p key={v.label}><i style={{ background: v.color }}/><span>{v.label}</span><b>{v.count}</b></p>)}</div></div>;
}
