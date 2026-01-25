const express = require('express');
const fetch = require('node-fetch');
const CryptoJS = require('crypto-js');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'Y9E5nOuoqqnJKx9N9Ub5yQqSSMpaiU';
const API_SECRET = process.env.API_SECRET || '9DTwsHvCzcHnRHXvvMgbORaEp5aR2mx9cUDBaOVltZABh9H9qj6WJxAYjPSY';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8327311469:AAFl4m0qbzJSCCRcCQUH1RUGNW-J98f40Co';
// Note: Chat ID usually detected automatically, but good to have env var if known
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || null;

const REST_API_URL = 'https://api.india.delta.exchange';

const fs = require('fs');
const path = require('path');

// --- EXPRESS SERVER (Health Check + Frontend) ---
const app = express();

// Serve the Frontend
app.get('/', (req, res) => {
    try {
        // Read the HTML file
        let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

        // Inject Environment Variables from Render into the Frontend CONFIG
        // We look for the existing hardcoded values and replace them, 
        // OR we can rely on a specific placeholder pattern if we had one.
        // But since we want to overwrite whatever is there (even if hardcoded dev keys):

        if (API_KEY) html = html.replace(/API_KEY:\s*['"][^'"]*['"]/, `API_KEY: '${API_KEY}'`);
        if (API_SECRET) html = html.replace(/API_SECRET:\s*['"][^'"]*['"]/, `API_SECRET: '${API_SECRET}'`);
        if (TELEGRAM_TOKEN) html = html.replace(/TELEGRAM_TOKEN:\s*['"][^'"]*['"]/, `TELEGRAM_TOKEN: '${TELEGRAM_TOKEN}'`);
        // We can also inject Chat ID if we have it
        if (TELEGRAM_CHAT_ID) {
            // If local storage reads null, this fallback in logic might not be enough unless we inject into the CONFIG default.
            // CONFIG has `TELEGRAM_CHAT_ID: localStorage... || null`
            // We can replace `|| null` with `|| '${TELEGRAM_CHAT_ID}'`
            html = html.replace(/\|\|\s*null/, `|| '${TELEGRAM_CHAT_ID}'`);
        }

        res.send(html);
    } catch (e) {
        console.error("Error serving frontend:", e);
        res.status(500).send("Error loading dashboard.");
    }
});

// Remove simple text response
// app.get('/', ...);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startBot();
});

// --- TELEGRAM SERVICE ---
class TelegramService {
    constructor() {
        this.token = TELEGRAM_TOKEN;
        this.baseUrl = `https://api.telegram.org/bot${this.token}`;
    }

    async getUpdates() {
        try {
            const response = await fetch(`${this.baseUrl}/getUpdates`);
            const data = await response.json();
            if (data.ok && data.result.length > 0) {
                // Find last private message
                const lastMsg = data.result.reverse().find(u => u.message && u.message.chat.type === 'private');
                if (lastMsg) {
                    TELEGRAM_CHAT_ID = lastMsg.message.chat.id;
                    console.log(`Telegram Chat ID Found: ${TELEGRAM_CHAT_ID}`);
                    this.sendMessage("✅ Antigravity Background Bot Connected!");
                    return true;
                }
            }
        } catch (e) {
            console.error("Telegram GetUpdates Error:", e.message);
        }
        return false;
    }

    async sendMessage(text) {
        if (!TELEGRAM_CHAT_ID) {
            await this.getUpdates(); // Try to lazy-fetch ID
        }
        if (!TELEGRAM_CHAT_ID) return;

        try {
            await fetch(`${this.baseUrl}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: text,
                    parse_mode: 'Markdown'
                })
            });
        } catch (e) {
            console.error("Telegram Send Error:", e.message);
        }
    }
}

const telegram = new TelegramService();

// --- STATE MANAGER ---
const alertHistory = {}; // Symbol -> Timestamp

// --- MAIN BOT LOGIC ---
async function startBot() {
    console.log("🚀 Starting Bot Loop...");

    // Initial Chat ID Check
    if (!TELEGRAM_CHAT_ID) {
        console.log("No Chat ID. Polling Telegram...");
        await telegram.getUpdates();
    }

    // Run immediately then loop
    botLoop();
    setInterval(botLoop, 60000); // Run every 60 seconds
}

async function botLoop() {
    try {
        // 1. Fetch Tickers (Prices, Funding Rates)
        // using v2/tickers for comprehensive data
        const tickersResp = await fetch(`${REST_API_URL}/v2/tickers`);
        const tickersData = await tickersResp.json();
        const tickers = tickersData.result;

        // 2. Fetch Products (Specs: Intervals, Contract Type)
        const productsResp = await fetch(`${REST_API_URL}/v2/products`);
        const productsData = await productsResp.json();
        const products = productsData.result;

        // 3. Process Data
        tickers.forEach(ticker => {
            // Filter: Only Futures/Perpetuals (usually what has funding)
            // But simplifying: checks if 'funding_rate' exists and not null
            if (!ticker.funding_rate) return;

            const productSpec = products.find(p => p.symbol === ticker.symbol);
            if (!productSpec) return; // Should match

            checkOpportunity(ticker, productSpec);
        });

    } catch (e) {
        console.error("Bot Loop Error:", e.message);
    }
}

function checkOpportunity(ticker, productSpec) {
    const symbol = ticker.symbol;
    const fundingRate = parseFloat(ticker.funding_rate);
    const absFunding = Math.abs(fundingRate); // Delta returns actual value e.g. 0.005 for 0.5% NO, Step 942 said 1.478% is returned as -1.4787.
    // Wait, verification step 1098 said "if (Math.abs(fundingRate) < 0.35) return;".
    // If API returns 0.0035 for 0.35%, then 0.0035 < 0.35 is true.
    // BUT Step 942 User Screenshot shows "-1.4968%".
    // If Raw was -0.0149 (1.49%), then toFixed(4) would be -0.0150.
    // The user screenshot shows "-1.4968%".
    // This implies the RAW value is indeed Percentage (e.g. -1.4968).
    // So my backend check `fundingRate < 0.35` is correct for Percentage value.

    // ALERT CRITERIA NO. 1: Funding >= 0.35%
    if (Math.abs(fundingRate) < 0.35) return;

    // DEBOUNCE: 15 Minutes (900000 ms)
    const lastSent = alertHistory[symbol];
    if (lastSent && (Date.now() - lastSent) < 900000) return;

    // Calc Time Left
    const intervalSeconds = productSpec.rate_exchange_interval || 28800; // 8h default
    const secondsRemaining = getSecondsToNextFunding(intervalSeconds);
    const minutesLeft = Math.floor(secondsRemaining / 60);

    // Format Alert
    sendAlert(ticker, fundingRate, minutesLeft, intervalSeconds);
}

function sendAlert(data, rate, minutesLeft, intervalSeconds) {
    const symbol = data.symbol;
    const intervalHours = intervalSeconds / 3600;
    const emoji = rate > 0 ? '🟢' : '🔴';
    const direction = rate > 0 ? 'Positive (Longs Pay Shorts)' : 'Negative (Shorts Pay Longs)';

    // Format Time: Xh Ym
    const h = Math.floor(minutesLeft / 60);
    const m = minutesLeft % 60;
    const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

    // Stats
    // Try to handle varied API response keys
    const change24h = parseFloat(data.mark_change_24h || data.price_change_percent_24h || 0);
    const turnover = parseFloat(data.turnover_usd || data.volume_24h || 0);
    const oi = parseFloat(data.oi_value_usd || data.open_interest || 0);

    const changeArrow = change24h >= 0 ? '↗️' : '↘️';

    const msg = `
🚨 **Funding Opportunity Alert** 🚨

**Contract:** \`${symbol}\`
**Funding Rate:** ${emoji} **${rate.toFixed(4)}%**
**Details:** ${direction}
**Window:** ${intervalHours}h Cycle
**Time Left:** ⏳ **${timeStr}**

📊 **Market Stats (24h)**
• Change: ${changeArrow} **${change24h.toFixed(2)}%**
• Volume: **${formatVolume(turnover)}**
• Open Interest: **${formatVolume(oi)}**

_Background Bot is monitoring..._
`;

    telegram.sendMessage(msg);
    alertHistory[symbol] = Date.now();
    console.log(`Alert sent for ${symbol}`);
}

// Helper: Format Volume (K/M/B)
function formatVolume(num) {
    if (!num) return '$0';
    if (num >= 1000000000) return '$' + (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return '$' + (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return '$' + (num / 1000).toFixed(2) + 'K';
    return '$' + num.toFixed(2);
}

// Helper: Time Calculation
function getSecondsToNextFunding(intervalSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const nextFunding = Math.ceil(now / intervalSeconds) * intervalSeconds;
    return nextFunding - now;
}

console.log("Server script loaded.");
