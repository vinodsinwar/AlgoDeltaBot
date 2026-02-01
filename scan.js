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

        // --- BUILD ALL-IN-ONE TABLE ---
        let msg = `🧪 **Profit Rate Scan** 🧪\n`;
        msg += `_Threshold: > ±0.35%_\n`;
        msg += `_Legend: 🔴 Shorts Pay Longs | 🟢 Longs Pay Shorts_\n\n`;

        msg += "```\n";
        // Header: Compact columns
        // CT(8) RT %(7) WT(6) Vol(6) OI(6) 24h%(5)
        msg += "CT       RT %    WT     Vol    OI     24h%\n";
        msg += "----------------------------------------------\n";

        opportunities.forEach(opp => {
            // 1. Symbol: Max 8 (Truncated later)
            // Remove 1000, USDT, and USD suffix
            let sym = opp.symbol.replace('1000', '').replace(/USDT?$/, '');
            if (sym.length > 8) sym = sym.substring(0, 8);

            // 2. Rate: -0.945 (6 chars)
            // Remove + sign to save space if needed? No, Keep sign.
            let rateStr = opp.rate.toFixed(3);
            if (opp.rate > 0) rateStr = '+' + rateStr; // +0.500

            // 3. Time: 6h25m (5-6 chars)
            const secondsRemaining = getSecondsToNextFunding(opp.interval);
            const h = Math.floor(secondsRemaining / 3600);
            const m = Math.floor((secondsRemaining % 3600) / 60);
            let timeStr = `${h}h${m}m`;
            // If 0h, just show XXm
            if (h === 0) timeStr = `${m}m`;

            // 4. Vol: 8.8M (4-5 chars)
            // Remove '$'
            const volStr = formatVolume(opp.turnover).replace('$', '');

            // 5. OI: 250K (4-5 chars)
            const oiStr = formatVolume(opp.oi).replace('$', '');

            // 6. Chg: +56% -> +56 (3-4 chars)
            // Remove % sign
            let chgStr = opp.change24h.toFixed(1);
            if (opp.change24h > 0) chgStr = '+' + chgStr;

            // Pad and Layout
            // Sym(8) Rate(7) Time(6) Vol(6) OI(6) Chg(5)
            // Strict Truncate to ensure they respect the pad length

            let pSym = sym.substring(0, 8).padEnd(8, ' ');
            let pRate = rateStr.substring(0, 7).padEnd(7, ' ');
            let pTime = timeStr.substring(0, 6).padEnd(6, ' ');
            let pVol = volStr.substring(0, 6).padEnd(6, ' ');
            let pOI = oiStr.substring(0, 6).padEnd(6, ' ');
            let pChg = chgStr.substring(0, 5).padEnd(5, ' ');

            // Add explicit space between columns
            msg += `${pSym} ${pRate} ${pTime} ${pVol} ${pOI} ${pChg}\n`;
        });
        msg += "```\n";
        msg += `_All values in USD_\n`;
        msg += `_Mission of 10 cr in 2026 :)_\n`;

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
