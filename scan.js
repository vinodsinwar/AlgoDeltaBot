const fetch = require('node-fetch');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8327311469:AAFl4m0qbzJSCCRcCQUH1RUGNW-J98f40Co';
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const REST_API_URL = 'https://api.india.delta.exchange';

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
                const lastMsg = data.result.reverse().find(u => u.message && u.message.chat);
                if (lastMsg) {
                    TELEGRAM_CHAT_ID = lastMsg.message.chat.id;
                    console.log(`✅ Auto-detected Chat ID: ${TELEGRAM_CHAT_ID}`);
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
            console.log("⚠️ Chat ID missing. Attempting to fetch from updates...");
            await this.getUpdates();
        }

        if (!TELEGRAM_CHAT_ID) {
            console.error("❌ TELEGRAM_CHAT_ID could not be found. Cannot send alert.");
            return;
        }

        // Split message if > 4096 characters
        const MAX_LENGTH = 4000;
        if (text.length <= MAX_LENGTH) {
            await this.sendChunk(text);
        } else {
            console.log(`⚠️ Message too long (${text.length} chars). Splitting...`);
            const chunks = text.match(new RegExp(`.{1,${MAX_LENGTH}}`, 'g'));
            for (const chunk of chunks) {
                await this.sendChunk(chunk);
            }
        }
    }

    async sendChunk(text) {
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
            console.log("✅ Message sent to Telegram");
        } catch (e) {
            console.error("Telegram Send Error:", e.message);
        }
    }
}

const telegram = new TelegramService();

// --- FORMATTING HELPERS ---
function formatVolume(num) {
    if (!num) return '$0';
    if (num >= 1000000000) return '$' + (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return '$' + (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return '$' + (num / 1000).toFixed(2) + 'K';
    return '$' + num.toFixed(2);
}

function getSecondsToNextFunding(intervalSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const nextFunding = Math.ceil(now / intervalSeconds) * intervalSeconds;
    return nextFunding - now;
}

// --- MAIN LOGIC ---
async function runScan() {
    console.log("🚀 Starting Cron Scan (Hybrid Mode)...");

    try {
        const tickersResp = await fetch(`${REST_API_URL}/v2/tickers`);
        const tickersData = await tickersResp.json();
        const tickers = tickersData.result;

        const productsResp = await fetch(`${REST_API_URL}/v2/products`);
        const productsData = await productsResp.json();
        const products = productsData.result;

        const opportunities = [];

        tickers.forEach(ticker => {
            if (!ticker.funding_rate) return;

            const fundingRate = parseFloat(ticker.funding_rate);
            const absFunding = Math.abs(fundingRate);

            if (absFunding < 0.35) return;

            const productSpec = products.find(p => p.symbol === ticker.symbol);
            if (!productSpec) return;

            // Extra Stats
            const change24h = parseFloat(ticker.mark_change_24h || ticker.price_change_percent_24h || 0);
            const turnover = parseFloat(ticker.turnover_usd || ticker.volume_24h || 0);
            const oi = parseFloat(ticker.oi_value_usd || ticker.open_interest || 0);

            opportunities.push({
                symbol: ticker.symbol,
                rate: fundingRate,
                absRate: absFunding,
                interval: productSpec.rate_exchange_interval || 28800,
                change24h,
                turnover,
                oi
            });
        });

        opportunities.sort((a, b) => b.absRate - a.absRate);

        if (opportunities.length === 0) {
            console.log("No opportunities found > 0.35%. Exiting.");
            process.exit(0);
        }

        // --- BUILD HYBRID MESSAGE ---
        let msg = `🧪 **Funding Rate Scan** 🧪\n`;
        msg += `_Found ${opportunities.length} opportunities > 0.35%_\n\n`;

        // 1. MINI TABLE (Summary)
        msg += "```\n";
        msg += "Sym      Rate     Time    Vol\n";
        msg += "------------------------------\n";

        opportunities.forEach(opp => {
            let sym = opp.symbol.replace('1000', '').replace('USDT', '');
            if (sym.length > 7) sym = sym.substring(0, 7);

            const rateStr = opp.rate > 0 ? `+${opp.rate.toFixed(3)}` : `${opp.rate.toFixed(3)}`;

            const secondsRemaining = getSecondsToNextFunding(opp.interval);
            const h = Math.floor(secondsRemaining / 3600);
            const m = Math.floor((secondsRemaining % 3600) / 60);
            const timeStr = `${h}h${m}m`;

            const volStr = formatVolume(opp.turnover).replace('$', '');

            msg += `${sym.padEnd(7)} ${rateStr.padEnd(7)} ${timeStr.padEnd(7)} ${volStr}\n`;
        });
        msg += "```\n\n";

        // 2. DETAILED BREAKDOWN
        msg += "**📋 Detailed Breakdown**\n\n";

        opportunities.forEach((opp, index) => {
            const emoji = opp.rate > 0 ? '🟢' : '🔴';
            const direction = opp.rate > 0 ? 'Positive (Longs Pay Shorts)' : 'Negative (Shorts Pay Longs)';

            const secondsRemaining = getSecondsToNextFunding(opp.interval);
            const h = Math.floor(secondsRemaining / 3600);
            const m = Math.floor((secondsRemaining % 3600) / 60);
            const timeStr = `${h}h${m}m`;

            const intervalHours = opp.interval / 3600;
            const changeArrow = opp.change24h >= 0 ? '↗️' : '↘️';

            msg += `**${index + 1}. ${opp.symbol}**\n`;
            msg += `   FRate: ${emoji} **${opp.rate.toFixed(4)}%**\n`;
            msg += `   Details: ${direction}\n`;
            msg += `   Cycle: ${intervalHours}h | Wait: ⏳ **${timeStr}**\n`;
            msg += `   Stats: ${changeArrow} **${opp.change24h.toFixed(2)}%** | Vol: **${formatVolume(opp.turnover)}** | OI: **${formatVolume(opp.oi)}**\n\n`;
        });

        console.log("--- GENERATED MESSAGE PREVIEW ---");
        console.log(msg);
        console.log("---------------------------------");

        await telegram.sendMessage(msg);

    } catch (e) {
        console.error("Scan Error:", e.message);
        process.exit(1);
    }
}

runScan();
