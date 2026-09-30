# Auditoría de color, tipografía y teclado — tienda y panel (C41)

Fecha: 29 de septiembre de 2026. Responsable: Claude. Alcance: tienda (`apps/web`) y panel (`apps/admin`). El análisis no cambió código; las correcciones se aplicaron el 30 de septiembre (C48, C49 y C51–C53) y se resumen al final.

## Veredicto

| | Tienda | Panel |
| --- | --- | --- |
| Contraste WCAG 2.2 AA | **Cumple.** 0 fallos de axe-core en 10 vistas; el texto visible más bajo tiene 5,82:1 | **No cumple.** 251 fallos de axe-core en 23 vistas (93 elementos distintos), más 29 en el editor de producto |
| Balance de color | Adecuado: el lima es un acento (0,6–5,5 % de la pantalla) | Suave y coherente a simple vista, pero con dos capas de estilos y unos 25 grises escritos a mano |
| ¿Demasiado fuerte? | No por el color. La sensación fuerte viene del marco oscuro de la portada y del exceso de negritas | No; el problema es el contrario: texto demasiado pequeño y pálido |
| Tipografía | Fuente del sistema, 12–44 px. Legible | DM Sans + Space Grotesk. El 30 % del texto mide 9–11 px |
| Teclado | **Cumple.** Compra completa solo con teclado; diálogos, menú y filtros correctos | Usable, con fallos: 6 botones sin nombre en el editor, foco tenue, el foco se queda en el menú al navegar y se pierde al archivar o crear un pedido |

La tienda está bien resuelta. El trabajo pendiente está casi entero en el panel.

## Método y entorno

- Google Chrome (versión estable instalada en esta Mac) sin interfaz, a 1440×900 (escritorio) y 390×844 (móvil), con movimiento reducido. Demo en memoria (`npm run demo`), sin tocar Atlas, con el catálogo inicial y las 7 fotos capturadas.
- Tienda: inicio, catálogo, ficha (`gold-standard-100-whey`), consulta de pedido y términos. Panel: inicio de sesión y las 18 secciones del menú en escritorio, 5 secciones en móvil y el editor de producto.
- **axe-core 4** con las reglas WCAG 2.0/2.1/2.2 A y AA; es la cifra oficial de fallos.
- **Medición propia** de cada texto visible: color, fondo efectivo (mezclando capas y opacidad), tamaño, peso, familia y ratio. Sirve para el inventario de pares y tamaños. No descarta botones deshabilitados, por eso sus totales del panel son algo mayores que los de axe.
- **Reparto de color:** píxeles de la pantalla visible agrupados en 4096 tonos.
- **Teclado:** recorridos con Tab y Shift+Tab (hasta 160 pasos por página). En cada paso se registra el nombre accesible del elemento, si el foco es visible y si cae en algo oculto. Además, flujos guiados con Enter, Espacio, flechas y Escape.
- Scripts y datos en bruto: `/private/tmp/…/scratchpad/audit/` durante esta sesión. Capturas en [auditoria-fase-c-evidencia/c41](auditoria-fase-c-evidencia/c41/).

**Límites.** No se probó con un lector de pantalla real (VoiceOver o NVDA), ni con personas, ni en modo de alto contraste de Windows, ni con zoom al 200 %. La demo tiene datos casi vacíos, así que los gráficos del panel salen en cero. La evaluación heurística la hizo un solo evaluador y no sustituye la prueba con personas (A07).

---

## 1. Color

### Por qué ese color

La tienda documenta su sistema al inicio de [styles.css](../apps/web/src/styles.css#L1-L5): *dos superficies* (marco oscuro en cabecera, portada y pie; zona clara para comprar) y *un color por rol*. El lima es la acción de compra, el oscuro la acción fuerte secundaria, el contorno la secundaria, y el verde, ámbar y rojo quedan solo para estados.

- **Lima `#c8ff3d` sobre verde casi negro `#0f130e`** es el lenguaje visual habitual de la suplementación y el gimnasio: energía, neón, contraste alto. Se distingue de las tiendas del sector que usan rojo o negro con amarillo.
- Funciona en las dos direcciones que se usan: texto oscuro sobre lima 15,92:1 y lima sobre oscuro 15,92:1.
- Su punto débil: **sobre blanco o papel el lima da 1,06–1,18:1**. Como texto o icono ahí sería invisible para mucha gente. La tienda lo respeta en todas partes: el botón principal lleva un borde `#4f6b00` (6,11:1) que lo delimita sobre fondo claro, y el lima no aparece como texto en la zona clara.

### Balance: cuánto ocupa cada color

Porcentaje de la pantalla visible (primer pantallazo):

| Vista | Oscuro | Claro | Lima |
| --- | --- | --- | --- |
| Inicio, escritorio | 56 % | 36 % | 0,8 % |
| Inicio, móvil | 66 % | 23 % | 3,6 % |
| Catálogo, escritorio | 14 % | 77 % | 0,8 % |
| Ficha, escritorio | 15 % | 77 % | 1,7 % |
| Carrito y pedido, móvil | 21 % | 67 % | 5,5 % |
| Términos, escritorio | 13 % | 79 % | 0,4 % |

Esto sigue la regla 60-30-10: la zona de compra es clara, el oscuro enmarca y el acento se dosifica. **El lima no es excesivo en ninguna vista.** La portada es la única vista mayoritariamente oscura (56–66 %), y es a propósito: es la vitrina.

**¿Es muy fuerte?** El color no. Lo que da sensación de dureza es:
1. **Las negritas:** el 52 % del texto de la tienda va en peso 700–900, y el 69 % si se cuenta el seminegrita (600).
2. **Las mayúsculas pequeñas con espaciado:** marcas y antetítulos, 132 elementos de 12–14 px.
3. **El marco oscuro** de cabecera, portada y pie.

Si se quiere una tienda más amable sin perder la marca, lo eficaz es bajar las negritas (descripciones y precios secundarios en 400–500) antes que tocar el lima.

### Contraste de la tienda

Se midieron 1140 textos visibles y **ninguno baja del mínimo**. Los pares más usados:

| Uso | Colores | Ratio |
| --- | --- | --- |
| Texto principal sobre blanco | `#141a12` / `#ffffff` | 17,7 |
| Texto secundario | `#4d5647` / `#ffffff` | 7,67 |
| Texto claro sobre marco oscuro | `#b7c0ae` / `#0f130e` | 9,97 |
| Botón principal | `#0f130e` / `#c8ff3d` | 15,92 |
| «Disponible» y existencias | `#2d6a1e` / `#ffffff` | 6,58 |
| Marca en tarjetas (el más bajo) | `#5f6858` / `#ffffff` | 5,82 |
| Portada «oro», antetítulo (degradado) | `#d9b25a` / `#2d2412` | 7,62 |
| Indicador de foco | `#1d5fd1` / `#f5f3ed` | 5,24 |

Aviso `#8a5200` (5,67 sobre su fondo) y error `#a3261a` (6,35) también cumplen. El borde de los campos `#7a8471` da 3,91 sobre blanco, por encima del 3:1 que se pide a los componentes.

### Contraste del panel

axe-core encuentra **251 textos por debajo de 4,5:1** en 23 vistas y 29 más en el editor de producto. Casi todos son **grises de texto secundario elegidos uno a uno**:

| Color / fondo | Ratio | Tamaño | Dónde |
| --- | --- | --- | --- |
| `#7a817b` / blanco | 3,99 | 10–14 px | Marca y categoría en la lista de productos, pedidos, configuración (48 casos) |
| `#738569` / `#f7f9f3` | 3,74 | **9 px** | Meses del gráfico (32) |
| `#697c54` / `#f4f6f2` | 4,18 | 10 px, mayúsculas | Antetítulos «EL NEGOCIO EN UN VISTAZO» (24) |
| `#9ba09c` / blanco | **2,63** | 13 px | «Gestión /» de la barra superior, en todas las secciones (18) |
| `#77836e` / blanco | 3,99 | 11–12 px | Líneas de «¿Cuánto queda?» (16) |
| `#7f8b79` / blanco | 3,57 | 11 px | Leyendas de los gráficos (13) |
| `#7b8676` / blanco | 3,80 | 10–11 px | Detalle de las métricas (12) |
| `#8c9780` / `#f4f6f2` | 2,81 | 10 px | «Última actualización» |

Otros datos:
- La barra lateral oscura sí cumple (6,1–15,6:1), aunque sus títulos de grupo miden 10 px.
- El texto del login está sobre un degradado; medido contra su punto más claro (`#34573d`) cumple: 4,78:1 o más.
- Los meses futuros desactivados del gráfico están exentos, pero los rótulos del eje «Oct, Nov, Dic» (`#c2cbbc`, 1,58:1, 9 px) no se leen.

**Causa de fondo:** el panel acumula tres hojas de estilo con paletas propias. [styles.css](../apps/admin/src/styles.css) define `--ink #151916` y `--acid #c8ff3d`; [workspace.css](../apps/admin/src/workspace.css) las reescribe con `--ink #17251d`, `--accent #b9ed5a` y `--muted #65716a`; y [business.css](../apps/admin/src/features/business/business.css) trae sus propios grises. El token `--muted #65716a` ya existe y **cumple (5,09:1 sobre blanco, 4,68:1 sobre el fondo `#f4f6f2`)**, pero la mayoría del texto secundario no lo usa. El panel y la tienda tampoco comparten marca: lima `#c8ff3d` frente a `#b9ed5a`, y oscuro `#0f130e` frente a `#17271f`. Los tokens de [packages/ui-core](../packages/ui-core/src/index.ts) están desactualizados respecto a ambos.

**Indicador de foco del panel:** el anillo de los botones `#70aa34` da **2,8:1 sobre blanco y 2,6:1 sobre el fondo**, y el de los campos `#85b85b` da **2,3:1 y 2,1:1**. El mínimo para un indicador de estado es 3:1 (WCAG 1.4.11). Se ve porque es grueso y verde, pero a quien tiene baja visión le cuesta. En la barra lateral oscura sí cumple (5,6:1).

---

## 2. Tipografía

### Tienda

- **Una sola familia: la del sistema** (`system-ui`, San Francisco, Segoe UI, Roboto). No descarga nada, carga al instante y cada persona ve la letra de su dispositivo. A cambio, no tiene una voz tipográfica propia; la marca depende del logo y del lima.
- **Tamaños:** 12–44 px, base de 16 px e interlineado de 1,5. El 26 % del texto mide 12–13 px (marcas, existencias, «Desde»), que es aceptable para datos secundarios. Las descripciones y los párrafos van a 15–17 px.
- **Pesos:** 400 (30 %), 600 (17 %), 700 (38 %), 800–900 (14 %). Hay más negrita de la necesaria (ver el apartado de color).

### Panel

- **DM Sans** para el texto (95 %) y **Space Grotesk** para títulos y cifras. Es una combinación correcta y moderna. Pero se cargan desde Google Fonts con `@import` ([styles.css:1](../apps/admin/src/styles.css#L1)): una petición externa que bloquea el pintado, envía la IP de cada empleado a Google y falla sin conexión.
- **Tamaños demasiado pequeños:** el tamaño base es 14 px, pero **el 30 % del texto mide 9–11 px** (1005 de 3351 elementos: 101 de 9 px, 278 de 10 px y 626 de 11 px). Hay 142 textos en mayúsculas de 9–10 px con espaciado amplio. Ejemplos: los grupos del menú (10 px), «GESTIÓN» (9 px), los meses (9 px), las etiquetas de estado (10 px, 9 px en móvil), los botones de las fotos (10 px) y «Borrador guardado» en móvil (10 px).
- En un panel que se usa horas cada día, esto cansa la vista. Junto con los grises de 3,6–4:1 es el principal problema de usabilidad del panel.

---

## 3. Heurísticas (Nielsen)

| Heurística | Tienda | Panel |
| --- | --- | --- |
| 1. Visibilidad del estado | ✔ Pasos «Carrito · Entrega · WhatsApp», avisos al agregar, disponibilidad por presentación | ✔ Completitud en %, «Sin cambios pendientes», aviso de modo demo |
| 2. Relación con el mundo real | ✔ Cantón, cédula, Servientrega, precios en USD | ~ Términos técnicos visibles: «Identificador del enlace», SKU, «Colección» |
| 3. Control y libertad | ✔ Escape cierra, filtros reversibles con chips, volver al carrito | ✔ Confirmación al salir con cambios, borrador recuperable |
| 4. Consistencia | ✔ Un color por rol, mismos botones en toda la tienda | ✘ Tres capas de estilos, dos verdes de acento, unos 25 grises, marca distinta de la tienda |
| 5. Prevención de errores | ✔ Cédula con dígito verificador, celular 09, dominio de correo | ✘ Los ejemplos de los campos («Ej. Gold Standard 100% Whey») se ven en seminegrita oscura y parecen datos ya escritos |
| 6. Reconocer antes que recordar | ✔ Etiquetas visibles, presentación elegida en texto | ✘ Botones solo con icono y sin nombre (volver, agregar y quitar opciones) |
| 7. Flexibilidad y eficiencia | ~ Tras agregar, llegar al carrito con teclado cuesta 20 Shift+Tab | ✘ Al cambiar de sección hacen falta 18 Tab para llegar al contenido |
| 8. Diseño estético y minimalista | ✔ Jerarquía clara; mucha negrita | ✘ Densidad alta con letra de 9–11 px |
| 9. Ayuda para recuperarse de errores | ✔ Mensajes que dicen cómo corregir | ✔ Mensajes de error en lenguaje claro |
| 10. Ayuda y documentación | ✔ WhatsApp en ficha y pie, políticas | ✔ «Cómo leer estas cifras», guías en `docs/` |

---

## 4. Accesibilidad con teclado

### Tienda: aprobada

Todas las comprobaciones pasan (19/19 en la pasada definitiva, más las de estructura):

- **Primer Tab:** aparece «Saltar al contenido» (visible, 177×48 px) y con Enter el foco pasa a `main`.
- **Indicador de foco visible en el 100 % de los elementos recorridos** (azul `#1d5fd1` en la zona clara y lima sobre fondo oscuro).
- **No hay** elementos que se puedan pulsar con el ratón y no se alcancen con Tab. El foco nunca cae en elementos ocultos.
- **Menú móvil:** abre con Enter, anuncia `aria-expanded`, se recorre con Tab y Escape lo cierra devolviendo el foco al botón.
- **«Entrar a mi cuenta»:** el foco entra en el diálogo, Tab y Shift+Tab no salen y Escape lo cierra devolviendo el foco.
- **Carrusel:** pausa y reproducción con Enter y avance manual con teclado. Respeta el movimiento reducido.
- **Catálogo:** los filtros se marcan con Espacio, los chips «Quitar filtro» se alcanzan y el orden tiene etiqueta. En móvil, el panel de filtros es modal: retiene el foco y Escape devuelve el foco al botón.
- **Ficha:** sabor y tamaño son grupos de radio que se cambian con flechas. La galería se amplía con Enter y Escape devuelve el foco a la foto.
- **Compra completa solo con teclado:** agregar, abrir el carrito, «Continuar con la entrega» (el foco pasa al título «Datos de entrega»), completar documento, nombre, celular, correo, provincia y cantón (escribiendo en el desplegable) y dirección, elegir envío con flechas y confirmar. Se registró el pedido RE-260929-EJLKC en la demo.
- **Consulta de pedido:** los campos tienen etiqueta y la validación del navegador avisa de los campos vacíos.

Mejoras menores:
- Tras «Agregar al carrito» el carrito no se abre. Se anuncia en una región viva («Producto agregado al carrito»), pero volver al botón del carrito cuesta 20 Shift+Tab. Conviene un «Ver carrito» junto al botón.
- El 34–39 % de los controles mide menos de 44 px, la meta propia de la tienda: enlaces de texto, migas y títulos de tarjeta de 17–21 px de alto. Cumplen el mínimo WCAG de 24 px por la excepción de espaciado, pero no la meta de 44 px en móvil.
- En móvil, las tarjetas pequeñas de la portada cortan el nombre y el precio cuando el producto no tiene foto («Gold Standa», «Desde $54,90» cortado).

### Panel: usable, con fallos

Lo que funciona:
- Inicio de sesión solo con teclado.
- «Saltar al contenido».
- Menú lateral alcanzable. En móvil el menú retiene el foco, Escape lo cierra y el foco vuelve a «Abrir menú».
- Indicador presente en todos los botones, enlaces y campos recorridos (18 secciones).
- Los diálogos de confirmación usan `<dialog>` nativo con título asociado, «Cancelar» enfocado por defecto y Escape para cancelar ([ConfirmDialog.tsx:39](../apps/admin/src/components/common/ConfirmDialog.tsx#L39)).
- Los botones de mes y de «Ventas / Resultado» anuncian su estado con `aria-pressed`.

Comprobado en ejecución (segunda pasada): salir del editor con cambios abre «Cambios sin guardar» con el foco en «Cancelar», el fondo queda inerte y Escape devuelve el foco al botón de volver. Los meses del gráfico se anuncian como «Enero: $0,00. Ver este mes.». «Este mes / Mes anterior / Este año» son accesos directos y no necesitan estado. Las fechas «Desde» y «Hasta» de Auditoría sí tienen indicador (2 px `#85b85b`): el aviso de la primera pasada era un falso positivo, porque Tab recorre día, mes y año dentro del mismo campo.

Fallos encontrados:

| Prioridad | Problema | Dónde |
| --- | --- | --- |
| Alta | **6 botones sin nombre accesible** en el editor de producto: la flecha para volver y los botones «+» y «×» de las opciones (sabores, tamaños, objetivos). Un lector de pantalla dice solo «botón» | [ProductEditor.tsx:82](../apps/admin/src/features/catalog/ProductEditor.tsx#L82), [TagEditor.tsx:7](../apps/admin/src/components/TagEditor.tsx#L7) |
| Alta | Los campos de opciones no están asociados a su etiqueta visible: su nombre sale solo del ejemplo («Agregar opción») | [TagEditor.tsx:7](../apps/admin/src/components/TagEditor.tsx#L7) |
| Media | Indicador de foco por debajo de 3:1 (botones 2,6–2,8:1, campos 2,1–2,3:1) | [workspace.css:3](../apps/admin/src/workspace.css#L3) |
| Media | **Archivar:** la confirmación aparece en la misma fila («¿Archivar…? Si, archivar / Cancelar»), pero el botón pulsado desaparece y el foco cae al inicio de la página. El lector de pantalla no anuncia la pregunta y Escape no cancela. Además, «Si» va sin tilde | [ProductEditor.tsx:230-244](../apps/admin/src/features/catalog/ProductEditor.tsx#L230-L244) |
| Media | **Crear pedido:** al abrir el editor de pedidos el foco también cae al inicio de la página; el editor tiene 21 textos con contraste insuficiente | Sección Pedidos |
| Baja | Las acciones de cada fila («Editar», «Duplicar», «Historial», «Archivar») no dicen de qué producto son; en la lista de botones del lector se repiten 20 veces | Lista de productos |
| Media | Al elegir una sección, el foco se queda en el menú: hacen falta 18 Tab para llegar al contenido. La tienda lo resuelve llevando el foco al título | [App.tsx:55-58](../apps/admin/src/App.tsx#L55-L58) |
| Media | «Carga rápida / Ficha completa» no anuncia cuál está activa (sin `aria-pressed`) | [ProductEditor.tsx:91](../apps/admin/src/features/catalog/ProductEditor.tsx#L91) |
| Baja | Grupos «Accesos de período» e «Indicador del gráfico» con `aria-label` en un `div` sin `role`; los lectores lo ignoran | Ventas y resultados |

---

## 5. Recomendaciones priorizadas

**Alta — panel**
1. **Un solo gris para texto secundario:** usar `var(--muted)` (`#65716a`, 5,09:1) en lugar de los unos 25 grises escritos a mano de las tres hojas de estilo. Corrige la mayoría de los 251 fallos. Aclarar el rótulo «Gestión /» y los meses futuros del eje.
2. **Tamaño mínimo de 12 px** (13 px para texto corrido) y nada en mayúsculas por debajo de 11 px. Meses del gráfico a 11–12 px.
3. **Nombrar los botones de icono:** `aria-label="Volver a productos"` en la flecha, `"Agregar {etiqueta}"` en «+» y `"Quitar {valor}"` en «×». Asociar la etiqueta con su campo en `TagEditor` (`useId` + `htmlFor`).
4. **Foco con 3:1 o más:** por ejemplo `#3f6f1f` (o tinta oscura con separación blanca) para botones y campos.

**Media — panel**
5. Llevar el foco al título de la sección tras navegar, igual que la tienda.
6. `aria-pressed` en «Carga rápida / Ficha completa» y `role="group"` en los grupos de segmentos.
7. Al pedir confirmación en la fila o abrir un editor, llevar el foco al primer control nuevo («Sí, archivar» o «Cancelar», o al título del editor), anunciar la pregunta y cancelar con Escape. Nombrar las acciones por fila con el producto (`aria-label="Archivar Gold Standard 100% Whey"`).
8. Unificar la paleta: tokens compartidos en `packages/ui-core` (tinta, lima, grises, estados) usados por la tienda y el panel, y retirar las capas antiguas de `styles.css`.
9. Ejemplos de campo en peso normal y con aspecto de ayuda, no de dato.
10. Servir DM Sans y Space Grotesk desde el propio sitio o usar la fuente del sistema, como la tienda.

**Baja — tienda (opcional, de estilo)**
11. Menos negritas en descripciones, precios secundarios y etiquetas para suavizar el conjunto sin tocar el lima.
12. Corregir el recorte de nombre y precio en las tarjetas pequeñas de la portada en móvil.
13. «Ver carrito» junto a «Agregar al carrito».
14. Acercar enlaces de texto y migas a 44 px de alto en móvil.

## Evidencia

Capturas en [auditoria-fase-c-evidencia/c41](auditoria-fase-c-evidencia/c41/): tienda en escritorio y móvil (inicio, catálogo, ficha, pedido y términos), flujos con teclado (saltar al contenido, menú móvil, diálogo de cuenta, filtros, galería, formulario y pedido final) y panel (inicio de sesión, las 18 secciones, editor, menú móvil y confirmaciones). Los datos en bruto (`tienda-paginas.json`, `tienda-flujos2.json`, `panel-paginas.json` y `panel-flujos*.json`) están en la misma carpeta.

---

## Correcciones aplicadas (30 de septiembre de 2026)

Medición con la misma herramienta, antes y después, en las 18 secciones del panel, 5 en el móvil y 6 editores (producto, pedido, campaña, gasto, compra y usuario), en la demo en memoria.

| | Antes | Después |
| --- | --- | --- |
| Fallos de contraste (axe-core), panel | 350 | **0** |
| Textos por debajo de 4,5:1 (medición propia), panel | 427 | **0** |
| Textos de menos de 12 px, panel | 1125 | **0** |
| Anillo de foco del panel | 2,1–2,8:1 | **5,5–6:1** (`#3f6f1f`); lima 13:1 en la barra oscura |
| Botones sin nombre en el editor | 6 | **0** (axe sin fallos) |
| Texto en negrita (700 o más), tienda | 52 % | **37 %** |
| Contraste de la tienda | 0 fallos | 0 fallos |

Qué se cambió:

- **Colores (C51):** 44 grises de texto que fallaban se oscurecieron lo justo para llegar a 4,6:1 sobre su fondo real. Solo se tocó el color del texto (nunca fondos, bordes ni la barra oscura). Las filas archivadas, bloqueadas o en borrador ya no atenúan el texto con opacidad: se marcan con un fondo o una franja. Los rótulos del gráfico pasaron a 12 px y a `#65716a`.
- **Tamaños (C51):** mínimo de 12 px en todo el panel. Sin desbordes a 1440, 820 y 360 px.
- **Foco (C51, C52):** anillo oscuro de 3 px en el contenido y lima en la barra lateral. Al elegir una sección o abrir un editor, el foco va a su título (también el `h2` del editor de pedidos). Al archivar, el foco va a «Cancelar», la pregunta se anuncia, Escape cancela y el foco vuelve a «Archivar…». Las acciones de cada fila nombran el producto.
- **Estados (C52):** «Carga rápida / Ficha completa» con `aria-pressed`; grupos de segmentos con `role="group"`; etiquetas de opciones asociadas a su campo.
- **Ejemplos de los campos (C51):** gris, en cursiva y en peso normal: ya no parecen datos escritos.
- **Fuentes (C51):** DM Sans y Space Grotesk se sirven desde el propio panel (@fontsource, solo latín). No hay peticiones a Google Fonts.
- **Textos:** «Ordenes» pasa a «Pedidos», como en el menú, y se corrigieron las tildes en textos visibles (Número, Envío, Sesión, Aún, Todavía, Carga rápida, Úsalo).
- **Tienda (C53):** menos negrita en antetítulos, marcas, etiquetas y pie; tarjetas pequeñas del carrusel sin recortes en el móvil; «Ver carrito (N)» junto a «Agregar al carrito» (dos Tab después de agregar); enlaces del pie, migas y marca con 44 px de alto en el móvil; franja del descuento en una sola línea desde 280 px; búsqueda con sinónimos de sabores («vainilla» encuentra «Vanilla»).
- **Tokens:** `packages/ui-core` tiene ahora los colores reales de la tienda y del panel, con sus contrastes.

Lo que no se cambió y por qué:

- **Títulos de las tarjetas en el móvil (28 px de alto):** cumplen el mínimo de 24 px de WCAG 2.2, y cada tarjeta ya tiene su botón de 44 px. Llevarlos a 44 px alargaría todas las tarjetas.
- **Puntos del carrusel (36 × 44 px) y enlaces dentro de párrafos:** cumplen el mínimo o están exentos.
- **Límites que siguen vigentes:** no se probó con lector de pantalla real, con personas ni con zoom al 200 %.

Evidencia: [c51-c53](auditoria-fase-c-evidencia/c51-c53/) con las mediciones JSON de antes y después y las capturas.
