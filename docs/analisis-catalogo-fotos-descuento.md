# Análisis: presentaciones en el catálogo, fotos por tamaño y descuento para clientes nuevos (C45)

Fecha: 29 de septiembre de 2026. Responsable: Claude. Solo análisis y propuestas: no se cambió código por este documento. Ningún descuento se implementa sin que el propietario decida importe y condiciones.

---

## 1. ¿Cómo ve el cliente las distintas medidas de un producto?

### Cómo funciona hoy

- **Una tarjeta por producto.** Sabores y tamaños se agrupan dentro del producto. Es lo correcto y lo que hacen las tiendas grandes: el cliente no ve «Gold Standard 2 lb» y «Gold Standard 5 lb» como productos distintos.
- La tarjeta muestra marca, nombre, «Desde $X» cuando hay precios distintos, «N presentaciones» y el botón «Ver opciones».
- En la ficha, el cliente elige sabor y tamaño con botones (se pueden usar con flechas del teclado) y ve el precio y las existencias de esa combinación.

Catálogo inicial (20 productos): 5 tienen una sola presentación y 15 tienen varias. De esos 15, 7 cambian de tamaño, 12 cambian de sabor y 4 cambian de ambos.

### ¿Es usable? ¿Lo entiende el cliente?

Agrupar está bien. Lo que confunde es cómo se resume en la tarjeta:

1. **«3 presentaciones» mezcla sabores y tamaños.** *Psychotic Gold · 3 presentaciones* son 3 sabores de un mismo tamaño (35 porciones), pero la mayoría leerá «3 tamaños». Pasa en **8 de los 15** productos con opciones.
2. **Los tamaños no se ven hasta entrar en la ficha.** Quien busca «creatina de 600 g» tiene que abrir cada producto.
3. **«Desde $59,90» no dice de qué tamaño es.**
4. **No hay filtro por tamaño ni por sabor.** Los filtros son disponibilidad, objetivo, marca y precio. La API ya admite filtrar por sabor; falta en la pantalla.
5. **Comparar tamaños es difícil.** No hay precio por porción o por kilo, y el cliente no sabe si el de 5 lb le conviene frente al de 2 lb.
6. **Datos duplicados en Atlas.** «Creatina Monohidratada Dargon Pharma» (1 kg) es un producto aparte de «Creatine Monohydrate» (300 g). Es la misma creatina en otro tamaño, así que sale en dos tarjetas y con dos nombres de marca («Dragon Pharma Labs» y «Dragon Pharma»). Es un problema de datos, no del sistema (ver C39).

### Propuesta, de menor a mayor esfuerzo

| # | Cambio | Qué resuelve | Esfuerzo |
| --- | --- | --- | --- |
| 1 | Tarjeta: **«2 tamaños · 2 sabores»** en vez de «3 presentaciones», o los tamaños a la vista («2 lb · 5 lb») | 1 y 2 | Pequeño (solo tienda) |
| 2 | **«Desde $59,90 · 2 lb»** | 3 | Pequeño |
| 3 | Unir el 1 kg como presentación de «Creatine Monohydrate», archivar el duplicado y unificar la marca en *Categorías y marcas* | 6 | Tarea de datos en el panel, sin código |
| 4 | **Filtro por sabor** en el catálogo (la API ya lo admite) | 4 | Pequeño |
| 5 | **Filtro por tamaño** | 4 | Medio (API y tienda) |
| 6 | **Precio por porción** bajo cada tamaño («$1,00 por porción») | 5 | Medio: requiere guardar porciones por presentación, un dato que hoy no existe |

Recomendación: hacer ya 1, 2 y 3; después, 4; y 5 y 6 cuando el catálogo crezca.

---

## 2. Carga de fotos en el panel, por tamaño

### Cómo funciona hoy

- Las fotos se asignan **a cada variante**, es decir, a cada combinación de sabor y tamaño, con un máximo de 8 por variante ([VariantMatrix.tsx](../apps/admin/src/components/VariantMatrix.tsx)).
- Cada fila tiene «Subir» y «Biblioteca», y debajo hay una galería por variante. Se puede arrastrar, ordenar con ← →, quitar y usar «Mover a…» o «Copiar a…» **de a una variante cada vez**.
- Las fotos se reducen en el navegador y se guardan una sola vez aunque se repitan, porque se identifican por su contenido.
- En la tienda, la ficha muestra las fotos de la variante elegida. Si esa variante no tiene fotos, muestra la foto principal del producto, que puede ser de otro sabor o tamaño.

### Problemas

1. **Trabajo repetido.** Un producto de 3 sabores × 2 tamaños tiene 6 galerías. Poner las mismas 4 fotos del envase de 2 lb en los 3 sabores obliga a subirlas una vez y hacer 8 veces «Copiar a…».
2. **El caso habitual es por tamaño y el panel lo organiza por variante.** El envase cambia con el tamaño; el sabor suele cambiar solo la etiqueta.
3. **Texto alternativo pobre.** Por omisión, el texto que describe la foto es el código SKU («GS-WHEY-CHOC-2LB»), que no le sirve a quien usa lector de pantalla. El script de sincronización ya genera «Título, sabor, tamaño», pero el panel no.
4. **Foto equivocada en la tienda.** Si un sabor queda sin fotos, la tienda enseña la de otro sabor.

### Propuesta: «Fotos por tamaño»

- En el editor, en lugar de una galería por variante, **una galería por tamaño** («2 lb», «5 lb»). Lo que se sube ahí se aplica a todos los sabores de ese tamaño.
- Dentro de cada tamaño, **opcionalmente, fotos propias de un sabor** (por ejemplo, la etiqueta del sabor), que se añaden a las del tamaño.
- **Subida en bloque:** se sueltan varias fotos y el panel las reparte según el nombre del archivo (`…-2lb-…`, `…-5lb-…`) o pregunta a qué tamaño va cada una.
- **Texto alternativo automático** «Gold Standard 100% Whey, Double Rich Chocolate, 2 lb», editable.

Dos formas de hacerlo:

| Opción | Cómo | Ventajas | Límites |
| --- | --- | --- | --- |
| **A. Solo en el panel (recomendada para empezar)** | La galería por tamaño escribe la misma foto en todas las variantes de ese tamaño; los datos se guardan como hoy | Sin migración ni cambios en la API ni en la tienda; las fotos no ocupan más espacio | Si alguien edita un sabor a mano, ese sabor deja de ser idéntico al grupo; el panel lo marcaría como «personalizado» |
| B. Nuevo modelo de datos | Fotos a nivel de producto y de tamaño; la tienda elige variante, luego tamaño, luego producto | Más ordenado a largo plazo | Requiere cambios en esquema, API y tienda, y migrar los productos existentes |

Esfuerzo estimado de la opción A: alrededor de un día de desarrollo, más pruebas y capturas.

---

## 3. ¿Un descuento para clientes nuevos?

### Contexto que condiciona la decisión

- Hoy **no se necesita cuenta para comprar**, y conviene mantenerlo: reduce abandono.
- **Las cuentas no verifican el correo**, y la tienda no tiene SMTP configurado. Un descuento «por crear cuenta» se abusaría creando cuentas con correos inventados.
- El pedido **ya exige cédula, RUC o pasaporte** (con dígito verificador), un celular 09 válido y un correo con dominio real. **El documento es la mejor llave** para «una sola vez por persona».
- Los precios y los totales **los calcula el servidor**. Un descuento también debe calcularse ahí, nunca en el navegador.
- Existe un sistema de puntos (`vitalCoinsReward`): el servidor los calcula, pero la tienda no los muestra y no hay canje. No sirve como incentivo hasta definir cómo se canjean.

### Opciones

| Opción | Control del abuso | Fricción | Comentario |
| --- | --- | --- | --- |
| **1. Primera compra por documento (recomendada)** | Una vez por cédula/RUC; además, se rechaza si el celular o el correo ya compraron | Ninguna: se aplica al escribir el documento en el pago | Encaja con el flujo actual y no obliga a crear cuenta |
| 2. Envío gratis en la primera compra | Igual que la 1 | Ninguna | Coste acotado (USD 4–5) y fácil de entender; buena alternativa si el margen es corto |
| 3. Descuento por crear cuenta | Débil sin verificar el correo | Alta: obliga a registrarse antes de comprar | Solo con verificación de correo (SMTP) y, aun así, conviene atarlo al documento |
| 4. Código por WhatsApp o redes | Débil: los códigos se comparten | Media | Útil para campañas puntuales, no como bienvenida permanente |

### Dónde mostrarlo en el flujo

1. **Franja superior**, junto al envío: «Primera compra: −USD X».
2. **Ficha, bajo el precio**, en pequeño: «Tu primera compra tiene USD X de descuento al confirmar».
3. **Carrito:** una línea «Descuento de primera compra (se confirma con tu documento)».
4. **Paso de entrega, al escribir la cédula:** «¡Se aplicó tu descuento de primera compra!» o «Este documento ya tiene compras».
5. **Tras comprar:** «Crea tu cuenta para seguir tus pedidos». Encaja con C44: el pedido aparece al instante.

Evitar las ventanas emergentes al entrar: molestan en el móvil, tapan el catálogo y empeoran la primera impresión.

### Cómo se controlaría (si se aprueba)

- Configuración en *Pagos y envíos* del panel: activar o desactivar, tipo (importe fijo, porcentaje o envío gratis), valor, compra mínima, fecha de fin y tope mensual.
- El servidor comprueba, **dentro de la misma transacción que crea el pedido**, que el documento, el celular y el correo no tengan pedidos previos no cancelados. Un registro único por documento impide usarlo dos veces aunque lleguen dos pedidos a la vez.
- Si el pedido se cancela o vence sin pagar, el beneficio vuelve a quedar disponible.
- El pedido guarda la línea de descuento (para la factura y los reportes), y *Ventas y resultados* muestra cuánto se otorgó.
- Texto de condiciones en *Términos*: vigencia, compra mínima, una vez por persona y que no es acumulable. La LODC exige informar las condiciones de las promociones.

### Decisiones que necesito del propietario

1. ¿Descuento sí o no? Si es sí: ¿importe fijo, porcentaje o envío gratis?
2. Valor, compra mínima y fecha de fin.
3. ¿Acumulable con el envío express gratis desde USD 75?
4. ¿Tope de presupuesto mensual?

Con esas respuestas, la implementación estimada es de 2 a 3 días: API, panel, tienda, pruebas en MongoDB real y capturas.
