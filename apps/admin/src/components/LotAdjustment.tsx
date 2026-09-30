import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useRef, useState } from "react";
import { useUnsavedChanges } from "./common/UnsavedChanges";
type Position = {productId:string;sku:string;warehouseId:string;lot:string;expiresOn:string;unitCost:number|null;quantity:number;reserved?:number};
const STOCK=gql`query LotStock($id:ID!){product(id:$id){id variants{sku stock}}}`;
const ADJUST=gql`mutation AdjustLot($input:JSON!){adjustStock(input:$input)}`;
export function LotAdjustment({position,onClose,onSaved}:{position:Position;onClose:()=>void;onSaved:(message:string)=>void}) {
  const client=useApolloClient();const [delta,setDelta]=useState(0);const [reason,setReason]=useState("");const [error,setError]=useState("");
  const saving=useRef(false);const [busy,setBusy]=useState(false);
  const query=useQuery<{product:{variants:Array<{sku:string;stock:number}>}|null}>(STOCK,{variables:{id:position.productId},fetchPolicy:"network-only"});
  const [save]=useMutation(ADJUST);const variant=query.data?.product?.variants.find(v=>v.sku===position.sku);
  useUnsavedChanges(delta!==0||Boolean(reason),{busy});
  return <form className="report-card" onSubmit={async event=>{
    event.preventDefault();if(!variant||saving.current)return;
    saving.current=true;setBusy(true);setError("");
    try {
      const{warehouseId,lot,expiresOn,unitCost}=position;
      await save({variables:{input:{productId:position.productId,sku:position.sku,expectedStock:variant.stock,expectedLotQuantity:position.quantity,delta,reason,position:{warehouseId,lot,expiresOn,unitCost}}}});
      let message="Ajuste del lote guardado. Las unidades reservadas se conservaron.";
      await client.refetchQueries({include:"active"}).catch(()=>{message="Ajuste del lote guardado. Actualiza el inventario antes de realizar otro ajuste.";});
      setDelta(0);setReason("");onSaved(message);
    } catch(error) {setError(error instanceof Error?error.message:"No se pudo ajustar");}
    finally {saving.current=false;setBusy(false);}
  }}>
    <h2>Ajustar lote {position.lot} · {position.sku}</h2>
    <p>Vencimiento: {position.expiresOn||"sin registrar"} · Costo: {position.unitCost===null?"sin registrar":`$${position.unitCost.toFixed(2)}`}.</p>
    <p>El ajuste afecta únicamente a esta bodega, lote, vencimiento y costo. {position.quantity} unidades sin reservar; {position.reserved??0} reservadas.</p>
    <fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <label>Entrada (+) / salida (−)<input required type="number" min={-position.quantity} max={100000} value={delta} onChange={event=>setDelta(Number(event.target.value))}/></label>
      <label>Motivo<textarea required minLength={5} maxLength={300} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <p>Unidades sin reservar: {position.quantity} → {position.quantity+delta}. Se conservan las reservas.</p>
      {(error||query.error)&&<p role="alert">{error||query.error?.message}</p>}
      <div className="dialog-actions"><button type="button" onClick={onClose}>Cerrar</button><button disabled={query.loading||!variant||!delta}>{busy?"Guardando…":"Guardar ajuste del lote"}</button></div>
    </fieldset>
  </form>;
}
