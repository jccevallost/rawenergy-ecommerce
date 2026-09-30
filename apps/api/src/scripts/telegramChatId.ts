import { env } from "../config/env.js";

/**
 * Imprime los chat id disponibles para el bot. Es el dato incomodo de la
 * configuracion: el token lo da BotFather, pero el chat id solo aparece
 * despues de que alguien le escriba al bot.
 *
 *   1. Crea el bot con @BotFather y copia el token.
 *   2. Ponlo en TELEGRAM_BOT_TOKEN.
 *   3. Escribele algo al bot desde el telefono, o agregalo a un grupo.
 *   4. npm run telegram:chat -w @vital-forge/api
 */
const token = env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Falta TELEGRAM_BOT_TOKEN. Creá el bot con @BotFather y pone el token en apps/api/.env");
  process.exit(1);
}

const response = await fetch(`${env.telegramApiUrl}/bot${token}/getUpdates`);
const payload = await response.json() as {
  ok: boolean;
  description?: string;
  result?: Array<{ message?: { chat?: { id: number; type: string; title?: string; username?: string; first_name?: string } } }>;
};

if (!payload.ok) {
  console.error(`Telegram respondio con un error: ${payload.description ?? response.status}`);
  process.exit(1);
}

const chats = new Map<number, string>();
for (const update of payload.result ?? []) {
  const chat = update.message?.chat;
  if (chat) chats.set(chat.id, chat.title ?? chat.username ?? chat.first_name ?? chat.type);
}

if (!chats.size) {
  console.info("El bot todavia no recibio ningun mensaje. Escribile algo desde el telefono y volve a correr esto.");
  process.exit(0);
}

console.info("Chats disponibles. Copia el id en TELEGRAM_CHAT_ID:\n");
for (const [id, nombre] of chats) console.info(`  ${id}  ${nombre}`);
