import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useRef, useState } from "react";
import type { Order } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { useLeaveGuard, useUnsavedChanges } from "./common/UnsavedChanges";
import { useConfirm } from "./common/ConfirmDialog";
const DETAIL = gql`query OrderOperations($id:ID!){order(id:$id){id status paidAt operations}}`;
const RETURN = gql`mutation RecordOrderReturn($id:ID!,$input:JSON!){recordOrderReturn(id:$id,input:$input){id status allowedNextStatuses}}`;
const REFUND = gql`mutation RecordOrderRefund($id:ID!,$input:JSON!){recordOrderRefund(id:$id,input:$input){id status}}`;
type Operations = { history: Array<{from:string;to:string;at:string;reason:string}>; returnInfo?: {at:string;restocked:boolean;reason:string}; refund?: {at:string;amount:number;reference:string}; returns?: Array<{at:string;reason:string;restocked:boolean;items:Array<{variantSku:string;title:string;quantity:number;value:number}>}> };
export function OrderOperations({order, readonly, onNotice}:{order:Order;readonly?:boolean;onNotice?:(message:string)=>void}) {
  const client=useApolloClient(); const confirm=useConfirm(); const leave=useLeaveGuard();
  const [open,setOpen]=useState(false); const [action,setAction]=useState<"return"|"refund"|null>(null);
  const [reason,setReason]=useState(""); const [reference,setReference]=useState(""); const [restock,setRestock]=useState(false); const [message,setMessage]=useState(""); const [units,setUnits]=useState<Record<string,number>>({});
  const submitting=useRef(false);const [busy,setBusy]=useState(false);
  const detail=useQuery<{order:{status:string;paidAt?:string;operations:Operations}}>(DETAIL,{variables:{id:order.id},skip:!open,fetchPolicy:"network-only"});
  const [recordReturn]=useMutation(RETURN); const [recordRefund]=useMutation(REFUND);
  useUnsavedChanges(Boolean(action&&(reason||reference||restock)),{busy});
  const current=detail.data?.order;const operations=current?.operations;
  // M43: unidades pendientes por presentación; por omisión se devuelve todo lo pendiente.
  const pending=(sku:string,quantity:number)=>quantity-(operations?.returns??[]).reduce((s,r)=>s+r.items.filter(i=>i.variantSku===sku).reduce((n,i)=>n+i.quantity,0),0);
  const begin=async(next:typeof action)=>{if(await leave()){setAction(next);setReason("");setReference("");setRestock(false);setMessage("");setUnits(Object.fromEntries(order.items.map(i=>[i.variantSku,pending(i.variantSku,i.quantity)])));}};
  return <div className="order-operations"><button disabled={busy} onClick={async()=>{if(!open||await leave()){setOpen(!open);setAction(null);}}}>{open?"Cerrar seguimiento":"Seguimiento y devoluciones"}</button>{open&&<div>
    {detail.loading&&<p role="status">Cargando seguimiento…</p>}{detail.error&&<p role="alert">{detail.error.message}</p>}
    <ol>{operations?.history?.map((event,index)=><li key={index}>{new Date(event.at).toLocaleString("es-EC",{timeZone:"America/Guayaquil"})} · {event.reason}</li>)}</ol>
    {operations?.returns?.filter((_,i,all)=>!operations.returnInfo||i<all.length-1).map((r,i)=><p key={i}>Devolución parcial del {new Date(r.at).toLocaleDateString("es-EC",{timeZone:"America/Guayaquil"})}: {r.items.map(x=>`${x.quantity} × ${x.title}`).join(", ")} · {formatMoney(r.items.reduce((s,x)=>s+x.value,0))} · {r.restocked?"repuesta en inventario":"sin reponer"}. Motivo: {r.reason}.</p>)}
    {operations?.returnInfo&&<p>Devolución recibida: {operations.returnInfo.restocked?"mercancía repuesta en inventario":"sin reposición de mercancía"}. Motivo: {operations.returnInfo.reason}.</p>}
    {operations?.refund&&<p>Reembolso registrado: {formatMoney(operations.refund.amount)} · Referencia {operations.refund.reference}.</p>}
    {!readonly&&current&&!detail.error&&<div className="row-actions">{["SHIPPED","COMPLETED"].includes(current.status)&&<button disabled={busy||detail.loading} onClick={()=>void begin("return")}>Registrar devolución recibida</button>}{["CANCELLED","RETURNED"].includes(current.status)&&current.paidAt&&!operations?.refund&&<button disabled={busy||detail.loading} onClick={()=>void begin("refund")}>Registrar reembolso realizado</button>}</div>}
    {action&&<form onSubmit={async event=>{
      event.preventDefault();if(submitting.current)return;
      if(action==="return"&&!Object.values(units).some(q=>q>0)){setMessage("Indica al menos una unidad que vuelve.");return;}
      submitting.current=true;setBusy(true);setMessage("");
      try {
        if(!await confirm({title:action==="return"?"Confirmar devolución recibida":"Confirmar reembolso realizado",message:action==="return"?(restock?`Confirma que recibiste e inspeccionaste ${Object.values(units).reduce((s,q)=>s+q,0)} unidades y que pueden volver a venderse. Vuelven a su recepción original.`:`Se registrará la devolución de ${Object.values(units).reduce((s,q)=>s+q,0)} unidades sin aumentar el inventario vendible.`):`Confirma que ya devolviste ${formatMoney(order.total)} por el medio de pago correspondiente. Este registro no realiza una transferencia bancaria.`,confirmLabel:"Registrar"}))return;
        await(action==="return"?recordReturn({variables:{id:order.id,input:{reason,restock,expectedReturns:operations?.returns?.length??0,items:Object.entries(units).filter(([,q])=>q>0).map(([variantSku,quantity])=>({variantSku,quantity}))}}}):recordRefund({variables:{id:order.id,input:{reason,reference}}}));
        const success=`${order.orderNumber}: ${action==="return"?"devolución recibida":"reembolso realizado"} registrado${action==="return"?"a":""}.`;
        setAction(null);setMessage(success);onNotice?.(success);
        await client.refetchQueries({include:"active"}).catch(()=>{const warning=`${success} Actualiza para ver los últimos datos.`;setMessage(warning);onNotice?.(warning);});
      }catch(error){setMessage(error instanceof Error?error.message:"No se pudo registrar");}
      finally{submitting.current=false;setBusy(false);}
    }}><fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
      {action==="refund"&&<p>Registra el reembolso completo de {formatMoney(order.total)} después de realizarlo. El panel conserva la referencia; no transfiere dinero.</p>}
      <label>Motivo<textarea required minLength={5} maxLength={300} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      {action==="return"&&<fieldset className="return-units"><legend>Unidades que vuelven</legend>{order.items.map(i=>{const max=pending(i.variantSku,i.quantity);return <label key={i.variantSku}>{i.title} · {i.variantSku} <small>(pendientes: {max})</small><input type="number" min={0} max={max} step={1} value={units[i.variantSku]??0} disabled={!max} onChange={event=>setUnits({...units,[i.variantSku]:Math.max(0,Math.min(max,Math.round(Number(event.target.value))))})}/></label>;})}</fieldset>}
      {action==="return"?<label className="checkbox-label"><input type="checkbox" checked={restock} onChange={event=>setRestock(event.target.checked)}/>Recibí estas unidades en condiciones de venta; reponer inventario</label>:<label>Referencia del reembolso<input required minLength={3} maxLength={120} value={reference} onChange={event=>setReference(event.target.value)}/></label>}
      <button>{busy?"Guardando…":"Guardar registro"}</button><button type="button" onClick={()=>void begin(null)}>Cancelar</button>
    </fieldset></form>}{message&&<p role="status">{message}</p>}
  </div>}</div>;
}
