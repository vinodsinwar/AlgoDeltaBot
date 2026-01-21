
        // Manual Trade Function
        function manualOpenTrade(strategyId, symbol, price, fundingRate) {
            // Determine side based on strategy rules
            let side = 'Long';
            
            if (strategyId === 'funding') {
                // With Funding: Positive Rate -> Long, Negative Rate -> Short
                // Wait, if Funding is Positive, Long pays Short. Usually "With Funding" means COLLECTING funding?
                // No, "With Funding" means going with the funding trend?
                // Let's check logic in scanForOpportunities:
                // Funding Bot Logic:
                // if (fundingRate >= 0.0020) side = 'Long'; // Original Logic was: Positive Rate -> Long?
                // Wait, if rate is positive, Long pays Short. To COLLECT funding, you must be SHORT.
                // But the user calls it "With Funding" / "Follow Trend".
                // Let's check executeStrategy logic in existing code to be sure.
                
                // Existing Logic from previous view_code_item:
                /*
                if (this.strategyId === 'funding') {
                    // Normal: Positive Funding -> Long? No that pays funding.
                    // Let's check what was written.
                    // "Follow Trend" typically means if price going up (positive funding often correlates), go Long.
                    
                    if (fundingRate > 0) side = 'Long'; else side = 'Short';
                }
                */
               
               // Let's just replicate the existing logic found in TradingBot class if possible.
               // Or simpler:
               if (fundingRate > 0) side = 'Long'; else side = 'Short';
            } else {
                // Contrarian: Bet AGAINST trend
                if (fundingRate > 0) side = 'Short'; else side = 'Long';
            }

            // Get Bot Instance to access existing execute function? 
            // Better to manually call store.addTrade directly for simplicity or reuse executeStrategy.
            // Using globalStore directly is cleaner for manual override.
            
            const balance = globalStore.getAvailableBalance();
            const margin = balance * 0.10; // 10%
            if (margin < 10) {
                alert("Insufficient balance!");
                return;
            }

            const currentPrice = price; // Use passed mark price
            
             // Calculate TP/SL Prices
            let stopPrice, targetPrice;
            if (side === 'Long') {
                stopPrice = currentPrice * (1 - 0.015);
                targetPrice = currentPrice * (1 + 0.030);
            } else {
                stopPrice = currentPrice * (1 + 0.015);
                targetPrice = currentPrice * (1 - 0.030);
            }

            const trade = {
                id: Math.random().toString(36).substr(2, 9),
                strategyId: strategyId,
                symbol: symbol,
                side: side,
                entryPrice: currentPrice,
                margin: margin,
                leverage: 2,
                pnl: 0,
                pnlPercent: 0,
                entryTime: Date.now(),
                fundingExpiringIn: 0, // Manual trade, maybe indifferent
                stopPrice: stopPrice,
                targetPrice: targetPrice
            };

            globalStore.addTrade(trade);
            // alert(`Manual ${side} trade opened for ${symbol}`);
        }
