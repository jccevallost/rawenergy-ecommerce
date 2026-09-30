import { gql, useMutation, useQuery } from "@apollo/client";
import { useState } from "react";
import { ShieldCheck, KeyRound } from "lucide-react";
import { useConfirm } from "../../components/common/ConfirmDialog";
const SESSIONS = gql`query MySessions { mySessions }`;
const REVOKE = gql`mutation RevokeSessions { revokeSessions }`;
export function SecurityPanel({ onLogout }: { onLogout: () => void }) {
  const query = useQuery<{ mySessions: { sessions: Array<{ id: string; createdAt: string; expiresAt: string; current: boolean }>; legacySession: boolean } }>(SESSIONS, { fetchPolicy: "network-only" }); const [revoke, state] = useMutation(REVOKE); const confirm = useConfirm();
  return <section className="admin-section"><div className="section-heading"><div><span className="kicker">MI CUENTA</span><h1>Acceso y sesiones</h1><p>Revisa tus accesos y cierra las sesiones de todos los dispositivos.</p></div><ShieldCheck/></div>{query.error && <p role="alert">{query.error.message}</p>}<div className="report-card"><h2>Sesiones vigentes</h2>{query.data?.mySessions.sessions.map((s) => <div className="rank-line" key={s.id}><div><b>{s.current ? "Esta sesión" : "Otro acceso"}</b><small>Inicio: {new Date(s.createdAt).toLocaleString("es-EC")}</small></div><span>Vence: {new Date(s.expiresAt).toLocaleDateString("es-EC")}</span></div>)}{query.data?.mySessions.legacySession && <p>Esta sesión se inició con la versión anterior. Puedes cerrarlas todas para renovar el acceso.</p>}{state.error && <p role="alert">{state.error.message}</p>}<button className="danger-button" disabled={state.loading} onClick={async () => { if (await confirm({ title: "Cerrar todas las sesiones", message: "Se cerrará también tu acceso actual. Deberás iniciar sesión nuevamente.", confirmLabel: "Cerrar sesiones", danger: true })) { try { await revoke(); onLogout(); } catch { /* displayed above */ } } }}>Cerrar todas las sesiones</button></div></section>;
}
