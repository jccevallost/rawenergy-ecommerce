// División político-administrativa del Ecuador y validaciones de los datos de
// entrega. Archivo idéntico en apps/api/src/data/ecuador.ts y
// apps/web/src/lib/ecuador.ts: la tienda lo usa para guiar y el servidor para
// decidir; una prueba de la tienda falla si difieren.
//
// 24 provincias y 223 cantones. Fuente: Wikipedia, «Anexo:Cantones de Ecuador»
// (consultado el 2026-09-27; incluye los cantones Borbón y Sevilla Don Bosco).
// Cada cantón es [nombre, cabecera cantonal]; si la cabecera se llama igual, solo [nombre].
type Canton = readonly [name: string, seat?: string];
export const ECUADOR: ReadonlyArray<{ province: string; cantons: ReadonlyArray<Canton> }> = [
  { province: "Azuay", cantons: [["Camilo Ponce Enríquez"], ["Chordeleg"], ["Cuenca"], ["El Pan"], ["Girón"], ["Guachapala"], ["Gualaceo"], ["Nabón"], ["Oña"], ["Paute"], ["Pucará"], ["San Fernando"], ["Santa Isabel"], ["Sevilla de Oro"], ["Sígsig"]] },
  { province: "Bolívar", cantons: [["Caluma"], ["Chillanes"], ["Chimbo", "San José de Chimbo"], ["Echeandía"], ["Guaranda"], ["Las Naves"], ["San Miguel"]] },
  { province: "Cañar", cantons: [["Azogues"], ["Biblián"], ["Cañar"], ["Déleg"], ["El Tambo"], ["La Troncal"], ["Suscal"]] },
  { province: "Carchi", cantons: [["Bolívar"], ["Espejo", "El Ángel"], ["Mira"], ["Montúfar", "San Gabriel"], ["San Pedro de Huaca", "Huaca"], ["Tulcán"]] },
  { province: "Chimborazo", cantons: [["Alausí"], ["Chambo"], ["Chunchi"], ["Colta", "Cajabamba"], ["Cumandá"], ["Guamote"], ["Guano"], ["Pallatanga"], ["Penipe"], ["Riobamba"]] },
  { province: "Cotopaxi", cantons: [["La Maná"], ["Latacunga"], ["Pangua", "El Corazón"], ["Pujilí"], ["Salcedo", "San Miguel"], ["Saquisilí"], ["Sigchos"]] },
  { province: "El Oro", cantons: [["Arenillas"], ["Atahualpa", "Paccha"], ["Balsas"], ["Chilla"], ["El Guabo"], ["Huaquillas"], ["Las Lajas", "La Victoria"], ["Machala"], ["Marcabelí"], ["Pasaje"], ["Piñas"], ["Portovelo"], ["Santa Rosa"], ["Zaruma"]] },
  { province: "Esmeraldas", cantons: [["Atacames"], ["Borbón"], ["Eloy Alfaro", "Valdéz"], ["Esmeraldas"], ["Muisne"], ["Quinindé", "Rosa Zárate"], ["Rioverde"], ["San Lorenzo"]] },
  { province: "Galápagos", cantons: [["Isabela", "Puerto Villamil"], ["San Cristóbal", "Puerto Baquerizo Moreno"], ["Santa Cruz", "Puerto Ayora"]] },
  { province: "Guayas", cantons: [["Alfredo Baquerizo Moreno"], ["Balao"], ["Balzar"], ["Colimes"], ["Coronel Marcelino Maridueña"], ["Daule"], ["Durán", "Eloy Alfaro"], ["El Empalme", "Velasco Ibarra"], ["El Triunfo"], ["General Antonio Elizalde"], ["Guayaquil"], ["Isidro Ayora"], ["Lomas de Sargentillo"], ["Milagro"], ["Naranjal"], ["Naranjito"], ["Nobol", "Narcisa de Jesús"], ["Palestina"], ["Pedro Carbo"], ["Playas", "General Villamil"], ["Salitre"], ["Samborondón"], ["San Jacinto de Yaguachi", "Yaguachi"], ["Santa Lucía"], ["Simón Bolívar"]] },
  { province: "Imbabura", cantons: [["Antonio Ante", "Atuntaqui"], ["Cotacachi"], ["Ibarra"], ["Otavalo"], ["Pimampiro"], ["San Miguel de Urcuquí", "Urcuquí"]] },
  { province: "Loja", cantons: [["Calvas", "Cariamanga"], ["Catamayo"], ["Celica"], ["Chaguarpamba"], ["Espíndola", "Amaluza"], ["Gonzanamá"], ["Loja"], ["Macará"], ["Olmedo"], ["Paltas", "Catacocha"], ["Pindal"], ["Puyango", "Alamor"], ["Quilanga"], ["Saraguro"], ["Sozoranga"], ["Zapotillo"]] },
  { province: "Los Ríos", cantons: [["Baba"], ["Babahoyo"], ["Buena Fe"], ["Mocache"], ["Montalvo"], ["Palenque"], ["Puebloviejo"], ["Quevedo"], ["Quinsaloma"], ["Urdaneta", "Catarama"], ["Valencia"], ["Ventanas"], ["Vinces"]] },
  { province: "Manabí", cantons: [["Bolívar", "Calceta"], ["Chone"], ["El Carmen"], ["Flavio Alfaro"], ["Jama"], ["Jaramijó"], ["Jipijapa"], ["Junín"], ["Manta"], ["Montecristi"], ["Olmedo"], ["Paján"], ["Pedernales"], ["Pichincha"], ["Portoviejo"], ["Puerto López"], ["Rocafuerte"], ["San Vicente"], ["Santa Ana"], ["Sucre", "Bahía de Caráquez"], ["Tosagua"], ["Veinticuatro de Mayo", "Sucre"]] },
  { province: "Morona Santiago", cantons: [["Gualaquiza"], ["Huamboya"], ["Limón Indanza", "General Leonidas Plaza Gutiérrez"], ["Logroño"], ["Morona", "Macas"], ["Pablo Sexto"], ["Palora"], ["San Juan Bosco"], ["Santiago", "Santiago de Méndez"], ["Sevilla Don Bosco"], ["Sucúa"], ["Taisha"], ["Tiwintza", "Santiago"]] },
  { province: "Napo", cantons: [["Archidona"], ["Carlos Julio Arosemena Tola"], ["El Chaco"], ["Quijos", "Baeza"], ["Tena"]] },
  { province: "Orellana", cantons: [["Aguarico", "Tiputini"], ["Francisco de Orellana", "El Coca"], ["La Joya de los Sachas"], ["Loreto"]] },
  { province: "Pastaza", cantons: [["Arajuno"], ["Mera"], ["Pastaza", "Puyo"], ["Santa Clara"]] },
  { province: "Pichincha", cantons: [["Cayambe"], ["Mejía", "Machachi"], ["Pedro Moncayo", "Tabacundo"], ["Pedro Vicente Maldonado"], ["Puerto Quito"], ["Quito"], ["Rumiñahui", "Sangolquí"], ["San Miguel de Los Bancos"]] },
  { province: "Santa Elena", cantons: [["La Libertad"], ["Salinas"], ["Santa Elena"]] },
  { province: "Santo Domingo de los Tsáchilas", cantons: [["La Concordia"], ["Santo Domingo"]] },
  { province: "Sucumbíos", cantons: [["Cascales", "El Dorado de Cascales"], ["Cuyabeno", "Tarapoa"], ["Gonzalo Pizarro", "Lumbaquí"], ["Lago Agrio", "Nueva Loja"], ["Putumayo", "Puerto El Carmen de Putumayo"], ["Shushufindi"], ["Sucumbíos", "La Bonita"]] },
  { province: "Tungurahua", cantons: [["Ambato"], ["Baños de Agua Santa", "Baños"], ["Cevallos"], ["Mocha"], ["Patate"], ["Quero"], ["San Pedro de Pelileo", "Pelileo"], ["Santiago de Píllaro", "Píllaro"], ["Tisaleo"]] },
  { province: "Zamora Chinchipe", cantons: [["Centinela del Cóndor", "Zumbi"], ["Chinchipe", "Zumba"], ["El Pangui"], ["Nangaritza", "Guayzimi"], ["Palanda"], ["Paquisha"], ["Yacuambi", "28 de Mayo"], ["Yantzaza"], ["Zamora"]] }
];

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export const provinceNames = ECUADOR.map(entry => entry.province);
export const findProvince = (name: string) => ECUADOR.find(entry => fold(entry.province) === fold(name)) ?? null;
/** Cantón por su nombre o por el de su cabecera (p. ej. «Sangolquí» → Rumiñahui). */
export function findCanton(province: string, city: string): Canton | null {
  const wanted = fold(city);
  return findProvince(province)?.cantons.find(([name, seat]) => fold(name) === wanted || (seat !== undefined && fold(seat) === wanted)) ?? null;
}
export const cantonLabel = ([name, seat]: Canton) => seat ? `${name} (${seat})` : name;

/** Express Quito y Valles: cantones Quito (incluye Cumbayá, Tumbaco y Conocoto) y Rumiñahui (Sangolquí). */
export const EXPRESS_CANTONS = ["Quito", "Rumiñahui"] as const;
export function isExpressArea(province: string, city: string) {
  const canton = findCanton(province, city);
  return fold(province) === "pichincha" && !!canton && EXPRESS_CANTONS.some(name => fold(name) === fold(canton[0]));
}

/** Celular ecuatoriano: 10 dígitos que empiezan en 09. Acepta espacios, guiones y +593. */
export function normalizeMobile(raw: string) {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("593") && digits.length === 12) digits = `0${digits.slice(3)}`;
  return digits;
}
export const mobileProblem = (raw: string) => /^09\d{8}$/.test(normalizeMobile(raw)) ? null : "Escribe tu celular de 10 dígitos que empieza con 09, por ejemplo 0991234567.";

// Cédula: provincia 01–24 o 30, tercer dígito menor a 6 y dígito verificador módulo 10.
function cedulaOk(digits: string) {
  if (!/^\d{10}$/.test(digits)) return false;
  const province = Number(digits.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30) || Number(digits[2]) >= 6) return false;
  const sum = [...digits.slice(0, 9)].reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(digits[9]);
}
/**
 * Cédula (10 dígitos) o RUC (13). Comprueba la estructura y el dígito
 * verificador; no confirma que el número pertenezca a quien lo escribe. En RUC
 * de sociedades solo se revisa la estructura: el SRI emite RUC recientes que no
 * cumplen el antiguo módulo 11.
 */
export function idNumberProblem(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!raw.trim()) return null;
  if (digits.length === 10) return cedulaOk(digits) ? null : "La cédula no es válida. Revisa los 10 dígitos.";
  if (digits.length === 13) {
    const province = Number(digits.slice(0, 2)), third = Number(digits[2]);
    const structure = ((province >= 1 && province <= 24) || province === 30) && (third < 6 || third === 6 || third === 9) && !digits.endsWith("000");
    if (!structure || (third < 6 && !cedulaOk(digits.slice(0, 10)))) return "El RUC no es válido. Revisa los 13 dígitos.";
    return null;
  }
  return "Escribe los 10 dígitos de tu cédula o los 13 de tu RUC.";
}

/** Identificación para la factura (tipos del SRI). El pasaporte, de extranjeros, no se verifica. */
export const ID_TYPES = [["CEDULA", "Cédula"], ["RUC", "RUC"], ["PASAPORTE", "Pasaporte"]] as const;
export type IdType = typeof ID_TYPES[number][0];
export const idTypeLabel = (type: IdType) => ID_TYPES.find(([value]) => value === type)?.[1] ?? type;
/** Tipo deducido cuando no se indica: 10 dígitos = cédula, 13 = RUC. */
export function inferIdType(raw: string): IdType | null {
  const compact = raw.replace(/[\s-]/g, "");
  return /^\d{10}$/.test(compact) ? "CEDULA" : /^\d{13}$/.test(compact) ? "RUC" : null;
}
export const normalizeIdentification = (type: IdType, raw: string) => type === "PASAPORTE" ? raw.replace(/[\s-]/g, "").toUpperCase() : raw.replace(/\D/g, "");
export function identificationProblem(type: IdType, raw: string): string | null {
  const value = normalizeIdentification(type, raw);
  if (!value) return type === "PASAPORTE" ? "Escribe el número de tu pasaporte." : "Escribe tu cédula o RUC; la necesitamos para la factura.";
  if (type === "PASAPORTE") return /^[A-Z0-9]{5,20}$/.test(value) ? null : "El pasaporte lleva de 5 a 20 letras o números.";
  if (type === "CEDULA") return value.length === 10 ? idNumberProblem(value) : "La cédula tiene 10 dígitos.";
  return value.length === 13 ? idNumberProblem(value) : "El RUC tiene 13 dígitos.";
}

// Correo: usuario@dominio.ext, sin espacios ni puntos dobles.
// Sin lookbehind: Safari anterior a 16.4 no lo entiende y rompería la tienda al cargar.
const EMAIL = /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
export const emailProblem = (raw: string) => {
  const value = raw.trim();
  return EMAIL.test(value) && value.length <= 120 && value.indexOf("@") <= 64 ? null : "Escribe un correo válido, por ejemplo nombre@gmail.com.";
};
const COMMON_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "hotmail.es", "outlook.es", "yahoo.es", "msn.com", "protonmail.com"];
function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}
/** Sugerencia para errores de tipeo en dominios comunes: «gmial.com» → «gmail.com». */
export function emailSuggestion(raw: string): string | null {
  const [user, domain] = raw.trim().toLowerCase().split("@");
  if (!user || !domain || COMMON_DOMAINS.includes(domain)) return null;
  const best = COMMON_DOMAINS.map(candidate => ({ candidate, cost: distance(domain, candidate) })).sort((a, b) => a.cost - b.cost)[0]!;
  return best.cost > 0 && best.cost <= 2 ? `${user}@${best.candidate}` : null;
}
