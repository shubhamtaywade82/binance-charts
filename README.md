# Binance Trading Dashboard & Public Charts

Rich, visual trading dashboard built using React, TypeScript, Express, and `binance-client-ts` for Binance public REST and WebSocket market data.

## Features
- **Crypto Trading Terminal:** Real-time Spot and Futures market charting (BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT, DOGE/USDT, etc.).
- **SMC (Smart Money Concepts):** Order Blocks, Fair Value Gaps (FVG), Market Structure Breaks (BOS/CHoCH), Liquidity Pools & Sweeps.
- **ICT Engine:** Kill Zones, Silver Bullet Windows, OTE Zones, Judas Swings, AMD Power of 3.
- **20-Depth Orderbook Stream:** Real-time bid/ask order depth streaming via Binance WebSocket.
- **Dark Mode Charting:** High-performance TradingView-style charts using `lightweight-charts`.

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run the development server:**
   ```bash
   npm run dev:all
   ```

3. **Open in browser:**
   Navigate to `http://localhost:5173`
