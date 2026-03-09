# Telegram bot deploy (veilig, zonder token in code)

Ik heb een eenvoudige Telegram echo-bot toegevoegd in `telegram-bot/`.

## Belangrijk

- **Commit je token nooit in Git.**
- Zet je token alleen als environment variable `TELEGRAM_BOT_TOKEN` in je deploy platform.
- Omdat je token hier in chat is gedeeld, is het verstandig die te **revoken/roteren** via BotFather.

## Lokaal testen

```bash
cd telegram-bot
TELEGRAM_BOT_TOKEN=your_token_here npm start
```

## Deploy op Railway (aanrader, snel)

1. Push deze repo naar GitHub.
2. Maak een nieuw Railway project vanaf je repo.
3. Kies service root: `telegram-bot`.
4. Start command: `npm start`.
5. Voeg env var toe:
   - `TELEGRAM_BOT_TOKEN=...`
   - optioneel `POLL_TIMEOUT_SECONDS=25`
6. Deploy.

## Healthcheck

De service expose't een HTTP endpoint op `PORT` met response:

```json
{"ok":true,"service":"telegram-bot"}
```
