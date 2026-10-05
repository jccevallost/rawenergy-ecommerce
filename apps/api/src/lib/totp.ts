import crypto from "node:crypto";

// Segundo factor del personal (C69, S10): códigos de 6 dígitos cada 30 segundos (TOTP,
// RFC 6238, HMAC-SHA1), compatibles con Google Authenticator, Microsoft Authenticator,
// 1Password o Authy. Sin dependencias externas.
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    value = (value << 5) | ALPHABET.indexOf(character); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo de 160 bits en base32 (lo que se escribe en la aplicación). */
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

/** Código de un paso de 30 s. */
export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(binary).padStart(DIGITS, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Paso que corresponde al código (se acepta uno antes y uno después por la hora del
 * teléfono), o null. Un paso igual o anterior a `lastStep` ya se usó y se rechaza.
 */
export function verifyTotp(secret: string, code: string, lastStep = -1, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (candidate <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, candidate));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) return candidate;
  }
  return null;
}

export const otpauthUrl = (issuer: string, account: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// El secreto se guarda cifrado (AES-256-GCM): si alguien leyera la base, no podría generar códigos.
const keyFrom = (secret: string) => crypto.createHash("sha256").update(`totp:${secret}`).digest();
export function encryptSecret(plain: string, appSecret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFrom(appSecret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}
export function decryptSecret(stored: string, appSecret: string) {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Secreto de verificación ilegible");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFrom(appSecret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// Códigos de recuperación: 8 de un solo uso, con forma XXXX-XXXX; se guarda su hash.
export const newRecoveryCodes = () => Array.from({ length: 8 }, () => {
  const raw = base32Encode(crypto.randomBytes(5)).slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
});
// Se aceptan 0, 1 y 8 escritos en lugar de O, I y B (se confunden al copiarlos a mano).
export const hashRecoveryCode = (code: string) => crypto.createHash("sha256").update(code.toUpperCase().replace(/0/g, "O").replace(/1/g, "I").replace(/8/g, "B").replace(/[^A-Z2-7]/g, "")).digest("hex");
