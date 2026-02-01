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
        // Generate Time-Based Sequence ID (HHmm in UTC) to act as unique run ID
        const now = new Date();
        const seq = now.getUTCHours().toString().padStart(2, '0') +
            now.getUTCMinutes().toString().padStart(2, '0');

        let msg = `## ${seq} - Profit Alert Scan 🔥💎\n`;
        msg += `TH: > ±0.35% | Short = Pay | Long = Receive\n\n`;

        msg += "```\n";
        // Header: Exact Alignment (Sym:6, Rate:6, Time:5, Vol:5, OI:5, Chg:5)
        let hSym = "CT".padEnd(6, ' ');
        let hRate = "RT%".padEnd(6, ' ');
        let hTime = "WT".padEnd(5, ' ');
        let hVol = "Vol".padEnd(5, ' ');
        let hOI = "OI".padEnd(5, ' ');
        let hChg = "24h%".padEnd(5, ' ');

        msg += `${hSym} ${hRate} ${hTime} ${hVol} ${hOI} ${hChg}\n`;
        msg += "--------------------------------------\n";

        opportunities.forEach(opp => {
            // 1. Symbol: Max 6 (e.g. BIGTIM)
            let sym = opp.symbol.replace('1000', '').replace(/USDT?$/, '');
            if (sym.length > 6) sym = sym.substring(0, 6);

            // 2. Rate: 6 chars (-0.980 or +0.500)
            let rateStr = opp.rate.toFixed(3);
            if (opp.rate > 0) rateStr = '+' + rateStr;
            // Strict truncate to 6
            if (rateStr.length > 6) rateStr = rateStr.substring(0, 6);

            // 3. Time: 5 chars (e.g. 5h12)
            const secondsRemaining = getSecondsToNextFunding(opp.interval);
            const h = Math.floor(secondsRemaining / 3600);
            const m = Math.floor((secondsRemaining % 3600) / 60);
            // Format: 5h12 (drop 'm' char)
            let timeStr = `${h}h${m.toString().padStart(2, '0')}`;

            // 4. Vol: 5 chars 
            let volStr = formatShort(opp.turnover);

            // 5. OI: 5 chars
            let oiStr = formatShort(opp.oi);

            // 6. Chg: +56% -> +56 (5 chars)
            let chgStr = opp.change24h.toFixed(1);
            if (opp.change24h > 0) chgStr = '+' + chgStr;

            // Pad and Layout
            // Strict Truncate

            let pSym = sym.substring(0, 6).padEnd(6, ' ');
            let pRate = rateStr.substring(0, 6).padEnd(6, ' ');
            let pTime = timeStr.substring(0, 5).padEnd(5, ' ');
            let pVol = volStr.substring(0, 5).padEnd(5, ' ');
            let pOI = oiStr.substring(0, 5).padEnd(5, ' ');
            let pChg = chgStr.substring(0, 5).padEnd(5, ' ');

            // Add explicit space between columns
            msg += `${pSym} ${pRate} ${pTime} ${pVol} ${pOI} ${pChg}\n`;
        });
        msg += "```\n\n";
        msg += `2026 : Discipline and right leverage - multi-millionaire throne claimed.🔥💎\n`;

        console.log("--- GENERATED MESSAGE PREVIEW ---");
        console.log(msg);
        console.log("---------------------------------");

        await telegram.sendMessage(msg);

    } catch (e) {
        console.error("Scan Error:", e.message);
        process.exit(1);
    }
}

// Helper: Smart Short Volume (Max ~5 chars)
function formatShort(num) {
    if (!num) return '0';
    let val, suffix;

    if (num >= 1000000000) {
        val = num / 1000000000;
        suffix = 'B';
    } else if (num >= 1000000) {
        val = num / 1000000;
        suffix = 'M';
    } else if (num >= 1000) {
        val = num / 1000;
        suffix = 'K';
    } else {
        return num.toFixed(0); // < 1000, 4 chars max
    }

    // Try 2 decimals
    let res = val.toFixed(2) + suffix;
    if (res.length <= 5) return res;

    // Try 1 decimal
    res = val.toFixed(1) + suffix;
    if (res.length <= 5) return res;

    // Try 0 decimals
    return val.toFixed(0) + suffix;
}

// Helper: Time Calculation
function getSecondsToNextFunding(intervalSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const nextFunding = Math.ceil(now / intervalSeconds) * intervalSeconds;
    return nextFunding - now;
}

runScan();
