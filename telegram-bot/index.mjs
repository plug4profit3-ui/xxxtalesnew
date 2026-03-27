import http from 'node:http';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const POLL_TIMEOUT_SECONDS = Number(process.env.POLL_TIMEOUT_SECONDS ?? 25);
const PORT = Number(process.env.PORT ?? 3000);

if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN environment variable.');
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function callTelegram(method, payload = {}) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    const description = data?.description ?? `HTTP ${res.status}`;
    throw new Error(`Telegram API error on ${method}: ${description}`);
  }

  return data.result;
}

let offset = 0;
let running = true;

async function handleUpdate(update) {
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;

  if (!chatId || !text) return;

  if (text === '/start') {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'Bot is live ✅\nStuur een bericht en ik echo het terug.',
    });
    return;
  }

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: `Echo: ${text}`,
  });
}

async function pollLoop() {
  while (running) {
    try {
      const updates = await callTelegram('getUpdates', {
        offset,
        timeout: POLL_TIMEOUT_SECONDS,
        allowed_updates: ['message'],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      console.error(error.message);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

const server = http.createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'telegram-bot' }));
});

server.listen(PORT, () => {
  console.log(`Health server listening on :${PORT}`);
});

process.on('SIGTERM', () => {
  running = false;
  server.close();
});
process.on('SIGINT', () => {
  running = false;
  server.close();
});

await pollLoop();
