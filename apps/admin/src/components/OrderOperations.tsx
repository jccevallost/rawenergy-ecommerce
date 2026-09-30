import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useRef, useState } from "react";
import type { Order } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { useLeaveGuard, useUnsavedChanges } from "./common/UnsavedChanges";
import { useConfirm } from "./common/ConfirmDialog";
const DETAIL = gql`query OrderOperations($id:ID!){order(id:$id){id status paidAt operations}}`;
const RETURN = gql`mutation RecordOrderReturn($id:ID!,$input:JSON!){recordOrderReturn(id:$id,input:$input){id status allowedNextStatuses}}`;
const REFUND = gql`mutation RecordOrderRefund($id:ID!,$input:JSON!){recordOrderRefund(id:$id,input:$input){id status}}`;
type Operations = { history: Array<{from:string;to:string;at:string;reason:string}>; returnInfo?: {at:string;restocked:boolean;reason:string}; refund?: {at:string;amount:number;reference:string} };
export function OrderOperations({order, readonly, onNotice}:{order:Order;readonly?:boolean;onNotice?:(message:string)=>void}) {
  const client=useApolloClient(); const confirm=useConfirm(); const leave=useLeaveGuard();
  const [open,setOpen]=useState(false); const [action,setAction]=useState<"return"|"refund"|null>(null);
  const [reason,setReason]=useState(""); const [reference,setReference]=useState(""); const [restock,setRestock]=useState(false); const [message,setMessage]=useState("");
  const submitting=useRef(false);const [busy,setBusy]=useState(false);
  const detail=useQuery<{order:{status:string;paidAt?:string;operations:Operations}}>(DETAIL,{variables:{id:order.id},skip:!open,fetchPolicy:"network-only"});
  const [recordReturn]=useMutation(RETURN); const [recordRefund]=useMutation(REFUND);
  useUnsavedChanges(Boolean(action&&(reason||reference||restock)),{busy});
  const current=detail.data?.order;const operations=current?.operations;
  const begin=async(next:typeof action)=>{if(await leave()){setAction(next);setReason("");setReference("");setRestock(false);setMessage("");}};
  return <div className="order-operations"><button disabled={busy} onClick={async()=>{if(!open||await leave()){setOpen(!open);setAction(null);}}}>{open?"Cerrar seguimiento":"Seguimiento y devoluciones"}</button>{open&&<div>
    {detail.loading&&<p role="status">Cargando seguimiento…</p>}{detail.error&&<p role="alert">{detail.error.message}</p>}
    <ol>{operations?.history?.map((event,index)=><li key={index}>{new Date(event.at).toLocaleString("es-EC",{timeZone:"America/Guayaquil"})} · {event.reason}</li>)}</ol>
    {operations?.returnInfo&&<p>Devolución recibida: {operations.returnInfo.restocked?"mercancía repuesta en inventario":"sin reposición de mercancía"}. Motivo: {operations.returnInfo.reason}.</p>}
    {operations?.refund&&<p>Reembolso registrado: {formatMoney(operations.refund.amount)} · Referencia {operations.refund.reference}.</p>}
    {!readonly&&current&&!detail.error&&<div className="row-actions">{["SHIPPED","COMPLETED"].includes(current.status)&&<button disabled={busy||detail.loading} onClick={()=>void begin("return")}>Registrar devolución recibida</button>}{["CANCELLED","RETURNED"].includes(current.status)&&current.paidAt&&!operations?.refund&&<button disabled={busy||detail.loading} onClick={()=>void begin("refund")}>Registrar reembolso realizado</button>}</div>}
    {action&&<form onSubmit={async event=>{
      event.preventDefault();if(submitting.current)return;
      submitting.current=true;setBusy(true);setMessage("");
      try {
        if(!await confirm({title:action==="return"?"Confirmar devolución recibida":"Confirmar reembolso realizado",message:action==="return"?(restock?"Confirma que recibiste e inspeccionaste toda la mercancía y que puede volver a venderse.":"Se registrará la devolución completa sin aumentar el inventario vendible."):`Confirma que ya devolviste ${formatMoney(order.total)} por el medio de pago correspondiente. Este registro no realiza una transferencia bancaria.`,confirmLabel:"Registrar"}))return;
        await(action==="return"?recordReturn({variables:{id:order.id,input:{reason,restock}}}):recordRefund({variables:{id:order.id,input:{reason,reference}}}));
        const success=`${order.orderNumber}: ${action==="return"?"devolución recibida":"reembolso realizado"} registrado${action==="return"?"a":""}.`;
        setAction(null);setMessage(success);onNotice?.(success);
        await client.refetchQueries({include:"active"}).catch(()=>{const warning=`${success} Actualiza para ver los últimos datos.`;setMessage(warning);onNotice?.(warning);});
      }catch(error){setMessage(error instanceof Error?error.message:"No se pudo registrar");}
      finally{submitting.current=false;setBusy(false);}
    }}><fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
      {action==="refund"&&<p>Registra el reembolso completo de {formatMoney(order.total)} después de realizarlo. El panel conserva la referencia; no transfiere dinero.</p>}
      <label>Motivo<textarea required minLength={5} maxLength={300} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      {action==="return"?<label className="checkbox-label"><input type="checkbox" checked={restock} onChange={event=>setRestock(event.target.checked)}/>Recibí todas las unidades en condiciones de venta; reponer inventario</label>:<label>Referencia del reembolso<input required minLength={3} maxLength={120} value={reference} onChange={event=>setReference(event.target.value)}/></label>}
      <button>{busy?"Guardando…":"Guardar registro"}</button><button type="button" onClick={()=>void begin(null)}>Cancelar</button>
    </fieldset></form>}{message&&<p role="status">{message}</p>}
  </div>}</div>;
}
