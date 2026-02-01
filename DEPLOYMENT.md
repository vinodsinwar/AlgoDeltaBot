# 🚀 Deployment Guide: Cron Job & Static Site

To reduce billing costs (from ~744 hours/mo to <1 hour/mo) and enable the new Tabular Alerts, follow these steps to migrate your Render setup.

## Step 1: Suspend the Old Web Service
1.  Go to your [Render Dashboard](https://dashboard.render.com/).
2.  Open your existing **Web Service** (the 24/7 bot).
3.  Click **Settings** > Scroll down to "Suspend Service" or "Delete Service".
    *   *Recommendation: Suspend it first to ensure the new setup works, then delete later.*

## Step 2: Create the Cron Job (The Bot)
1.  Click **New +** > **Cron Job**.
2.  Connect your GitHub Repository (`vinodsinwar/AlgoDeltaBot`).
3.  **Name**: `antigravity-bot-cron` (or similar).
4.  **Region**: Singapore (or closest to you).
5.  **Schedule**: `*/15 * * * *` (Runs every 15 minutes).
6.  **Command**: `node scan.js` (or `npm run scan`).
7.  **Environment Variables** (Copy from your old service):
    *   `API_KEY`: ...
    *   `API_SECRET`: ...
    *   `TELEGRAM_TOKEN`: ...
    *   `TELEGRAM_CHAT_ID`: **Crucial!** You must set this manually now because the Cron Job cannot "listen" for your messages to find it. Check your Telegram history or ask the bot in a group to find it if needed.
        *   If you don't know it, run the old bot for a minute, send a message, check the logs, copy the ID.
8.  **Create Cron Job**.

## Step 3: Create Static Site (The Dashboard)
1.  Click **New +** > **Static Site**.
2.  Connect the same GitHub Repo.
3.  **Name**: `antigravity-dashboard`.
4.  **Build Command**: `echo "Skipping build"` (or leave blank if allowed, or `./build.sh` if we added one. For now, just leaving it blank/default usually works for simple HTML).
    *   *Actually, Render Static Sites serve `index.html` by default from the Publish Directory.*
5.  **Publish Directory**: `./` (Root directory).
6.  **Environment Variables**:
    *   Render Static Sites *do not* inject env vars into client-side HTML easily without a build script.
    *   **However**, since your `index.html` might have hardcoded keys for now, it will work.
    *   If you want to secure it, we can settle that later. For now, just deploying it works.
7.  **Create Static Site**.

## usage
- The **Bot** runs every 15 minutes, checks market, sends ONE table if funding > 0.35%.
- The **Dashboard** is available at your new `onrender.com` URL (always free bandwidth).
