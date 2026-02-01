const fetch = require('node-fetch');

// --- CONFIGURATION ---
// Environment Variables (Set these in Render Cron Job)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8327311469:AAFl4m0qbzJSCCRcCQUH1RUGNW-J98f40Co';
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Must be set for Cron, or we fail (cannot poll updates reliably in run-once)

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

// --- MAIN LOGIC ---
async function runScan() {
    console.log("🚀 Starting Cron Scan...");

    try {
        // 1. Fetch Tickers
        const tickersResp = await fetch(`${REST_API_URL}/v2/tickers`);
        const tickersData = await tickersResp.json();
        const tickers = tickersData.result;

        // 2. Fetch Products (for specs like interval)
        const productsResp = await fetch(`${REST_API_URL}/v2/products`);
        const productsData = await productsResp.json();
        const products = productsData.result;

        // 3. Process & Filter
        const opportunities = [];

        tickers.forEach(ticker => {
            if (!ticker.funding_rate) return;

            const fundingRate = parseFloat(ticker.funding_rate);
            const absFunding = Math.abs(fundingRate);

            // Filter Criteria: > 0.35%
            if (absFunding < 0.35) return;

            const productSpec = products.find(p => p.symbol === ticker.symbol);
            if (!productSpec) return;

            opportunities.push({
                symbol: ticker.symbol,
                rate: fundingRate,
                absRate: absFunding,
                interval: productSpec.rate_exchange_interval || 28800
            });
        });

        // 4. Sort (Highest Absolute Rate First)
        opportunities.sort((a, b) => b.absRate - a.absRate);

        if (opportunities.length === 0) {
            console.log("No opportunities found > 0.35%. Exiting.");
            process.exit(0);
        }

        // 5. Build Tabular Message
        // Header
        let msg = `🧪 **Funding Rate Scan** 🧪\n`;
        msg += `_Threshold: > ±0.35%_\n\n`;

        // Table Header Code Block
        msg += "```\n";
        msg += "Sym      Rate     Time\n";
        msg += "----------------------\n";

        opportunities.forEach(opp => {
            // Symbol Truncate (max 8 chars for table align)
            let sym = opp.symbol.replace('1000', '').replace('USDT', '');
            // e.g. 1000SHIBUSDT -> SHIB
            // e.g. BTCUSDT -> BTC
            if (sym.length > 8) sym = sym.substring(0, 8);

            // Rate Format
            const rateStr = opp.rate > 0 ? `+${opp.rate.toFixed(3)}` : `${opp.rate.toFixed(3)}`; // +0.500 or -1.200

            // Time Calc
            const secondsRemaining = getSecondsToNextFunding(opp.interval);
            const h = Math.floor(secondsRemaining / 3600);
            const m = Math.floor((secondsRemaining % 3600) / 60);
            const timeStr = `${h}h${m}m`;

            // Padding
            const pSym = sym.padEnd(8, ' ');
            const pRate = rateStr.padEnd(8, ' ');
            const pTime = timeStr;

            msg += `${pSym} ${pRate} ${pTime}\n`;
        });
        msg += "```";

        console.log("--- GENERATED MESSAGE ---");
        console.log(msg);
        console.log("-------------------------");

        // 6. Send
        await telegram.sendMessage(msg);

    } catch (e) {
        console.error("Scan Error:", e.message);
        process.exit(1);
    }
}

// Helper: Time Calculation
function getSecondsToNextFunding(intervalSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const nextFunding = Math.ceil(now / intervalSeconds) * intervalSeconds;
    return nextFunding - now;
}

// Execute
runScan();
