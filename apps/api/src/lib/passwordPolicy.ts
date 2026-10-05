// Política de contraseñas (C60, S11). Clientes: 8 caracteres como mínimo. Personal del
// panel: 12, porque una cuenta de personal abre pedidos, datos de clientes y la cuenta
// de cobro. En ambos casos se rechazan las contraseñas más comunes y las que repiten
// el correo o el nombre de la tienda. No se consulta ningún servicio externo.
export const CUSTOMER_MIN_LENGTH = 8;
export const STAFF_MIN_LENGTH = 12;
export const MAX_LENGTH = 120;

// Listas públicas de contraseñas más usadas (en inglés y en español) y variantes de la tienda.
const COMMON = new Set([
  "123456", "1234567", "12345678", "123456789", "1234567890", "12345678910", "0123456789", "987654321", "123123123", "111111111",
  "000000000", "11111111", "00000000", "88888888", "12341234", "123qweasd", "1q2w3e4r", "1q2w3e4r5t", "qwertyuiop", "qwerty123",
  "qwerty1234", "qwertyui", "asdfghjkl", "zxcvbnm123", "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd",
  "iloveyou", "princess", "sunshine", "football", "baseball", "superman", "dragon123", "monkey123", "letmein123", "welcome1",
  "welcome123", "admin123", "administrator", "administrador", "admin1234", "abc12345", "abcd1234", "abcdefgh", "trustno1", "starwars",
  "contraseña", "contrasena", "contraseña1", "contrasena1", "contraseña123", "contrasena123", "teamo123", "tequiero", "ecuador123", "quito123",
  "guayaquil", "barcelona", "liverpool", "manchester", "realmadrid", "estrella", "mariposa", "chocolate", "corazon1", "amorcito",
  "rawenergy", "rawenergy1", "rawenergy123", "rawenergyec", "raw-energy", "suplementos", "proteina", "gimnasio", "fitness123", "creatina"
]);

export type PasswordContext = { staff?: boolean; email?: string; name?: string };

const simplify = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Motivo por el que la contraseña no sirve, o null si cumple. */
export function passwordProblem(password: string, context: PasswordContext = {}): string | null {
  const minimum = context.staff ? STAFF_MIN_LENGTH : CUSTOMER_MIN_LENGTH;
  if (password.length < minimum) return `Usa al menos ${minimum} caracteres${context.staff ? " en las cuentas del personal" : ""}.`;
  if (password.length > MAX_LENGTH) return `Usa como máximo ${MAX_LENGTH} caracteres.`;
  const plain = simplify(password);
  if (COMMON.has(plain) || COMMON.has(plain.replace(/[^a-z0-9ñ]/g, ""))) return "Esa contraseña es de las más usadas y fácil de adivinar. Elige otra.";
  if (/^(.)\1+$/.test(plain)) return "No uses el mismo carácter repetido.";
  const local = simplify(context.email ?? "").split("@")[0] ?? "";
  if (local.length >= 4 && plain.includes(local)) return "No incluyas tu correo en la contraseña.";
  const name = simplify(context.name ?? "").replace(/\s+/g, "");
  if (name.length >= 4 && plain.replace(/\s+/g, "").includes(name)) return "No incluyas tu nombre en la contraseña.";
  return null;
}
