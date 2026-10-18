// Modo de persistencia de todo el proceso (D03). Se fija al conectar y no cambia si la
// conexión con MongoDB se corta. Antes, unos servicios lo fijaban al arrancar y otros lo
// decidían con `readyState` en cada llamada: durante un corte breve un pedido podía quedar
// solo en memoria mientras el stock se descontaba en Atlas al volver la conexión. En modo
// MongoDB, una operación sin conexión espera a que vuelva (bufferTimeoutMS de Mongoose) y,
// si no vuelve, falla: nunca cae a los datos de demostración.
let mongo = false;

export function setMongoPersistence(enabled: boolean) {
  mongo = enabled;
}

export const usesMongo = () => mongo;
