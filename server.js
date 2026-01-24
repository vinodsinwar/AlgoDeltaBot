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

// --- EXPRESS SERVER (Health Check) ---
const app = express();

app.get('/', (req, res) => {
    res.send('✅ Antigravity Bot is Running 24/7! (v1.0.0)');
});

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
    const fundingRate = parseFloat(ticker.funding_rate); // e.g. 0.005
    const absFunding = Math.abs(fundingRate * 100); // Convert to % for easier check? 
    // Wait, API returns decimal? e.g. 0.0001 for 0.01%
    // In index.html we did `parseFloat(data.funding_rate)`.
    // If API returns "0.0050", that is 0.50%? Or is it 0.50? 
    // Let's cross-check usage in index.html.
    // In index.html: `const absFunding = Math.abs(parseFloat(data.funding_rate));`
    // And condition `if (absFunding < 0.50) return`.
    // This implies the API returns PERCENTAGE value directly as string? 
    // OR the user adjusted logic.
    // Step 942 Verification: User saw "-1.4787%" and logic was `toFixed(4)`.
    // If raw was 0.014787, toFixed(4) -> 0.0148. That's not -1.47%.
    // So the API returns the Percentage Value? 
    // Or I need to multiply by 100.
    // Re-reading Step 942: I updated `sendFundingAlert` to display `rate.toFixed(4)`.
    // If raw was -1.4787, then `toFixed(4)` is -1.4787. 
    // This means raw value IS percentage.
    // So `parseFloat(ticker.funding_rate)` is the percentage value.

    // ALERT CRITERIA NO. 1: Funding >= 0.5%
    if (Math.abs(fundingRate) < 0.50) return;

    // DEBOUNCE: 15 Minutes (900000 ms)
    const lastSent = alertHistory[symbol];
    if (lastSent && (Date.now() - lastSent) < 900000) return;

    // ALERT CRITERIA NO. 2: Window Check (REMOVED)
    // We only calculate it for display.

    // Calc Time Left
    const intervalSeconds = productSpec.rate_exchange_interval || 28800; // 8h default
    const secondsRemaining = getSecondsToNextFunding(intervalSeconds);
    const minutesLeft = Math.floor(secondsRemaining / 60);

    // Format Alert
    sendAlert(symbol, fundingRate, minutesLeft, intervalSeconds);
}

function sendAlert(symbol, rate, minutesLeft, intervalSeconds) {
    const intervalHours = intervalSeconds / 3600;
    const emoji = rate > 0 ? '🟢' : '🔴';
    const direction = rate > 0 ? 'Positive (Longs Pay Shorts)' : 'Negative (Shorts Pay Longs)';

    // Format Time: Xh Ym
    const h = Math.floor(minutesLeft / 60);
    const m = minutesLeft % 60;
    const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

    const msg = `
🚨 **Funding Opportunity Alert** 🚨

**Contract:** \`${symbol}\`
**Funding Rate:** ${emoji} **${rate.toFixed(4)}%**
**Details:** ${direction}
**Window:** ${intervalHours}h Cycle
**Time Left:** ⏳ **${timeStr}**

_Background Bot is monitoring..._
`;

    telegram.sendMessage(msg);
    alertHistory[symbol] = Date.now();
    console.log(`Alert sent for ${symbol}`);
}

// Helper: Time Calculation
function getSecondsToNextFunding(intervalSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const nextFunding = Math.ceil(now / intervalSeconds) * intervalSeconds;
    return nextFunding - now;
}

console.log("Server script loaded.");
