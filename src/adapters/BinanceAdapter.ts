import type {
  IDataAdapter, Candle, OrderBookLevel, TickPayload,
  SymbolDef, IntervalDef, FundsSnapshot,
} from "./IDataAdapter";

// Binance Futures adapter — all data comes from the chart-sdk backend
// which proxies to the existing binance-charts server routes.
export class BinanceAdapter implements IDataAdapter {
  readonly id = "binance";
  readonly name = "Binance Futures";
  readonly currency = "$";
  readonly is24x7 = true;

  private wsRef: WebSocket | null = null;

  getSymbols(): SymbolDef[] {
    return [
      { key: "btcusdt",  label: "BTC/USDT",  precision: 2 },
      { key: "ethusdt",  label: "ETH/USDT",  precision: 2 },
      { key: "solusdt",  label: "SOL/USDT",  precision: 2 },
      { key: "bnbusdt",  label: "BNB/USDT",  precision: 2 },
      { key: "xrpusdt",  label: "XRP/USDT",  precision: 4 },
    ];
  }

  getIntervals(): IntervalDef[] {
    return [
      { key: "1",   label: "1m"  },
      { key: "3",   label: "3m"  },
      { key: "5",   label: "5m"  },
      { key: "15",  label: "15m" },
      { key: "30",  label: "30m" },
      { key: "60",  label: "1h"  },
      { key: "240", label: "4h"  },
      { key: "D",   label: "1D"  },
    ];
  }

  async fetchCandles(symbol: string, interval: string, _limit = 500): Promise<Candle[]> {
    const res = await fetch(`/api/binance/charts/intraday?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
    const json = await res.json();
    return Array.isArray(json?.candles) ? json.candles : [];
  }

  async fetchHistoricalCandles(
    symbol: string, interval: string, fromTs: number, toTs: number
  ): Promise<Candle[]> {
    const from = new Date(fromTs * 1000).toISOString();
    const to   = new Date(toTs * 1000).toISOString();
    const res  = await fetch(
      `/api/binance/charts/historical?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&fromDate=${from}&toDate=${to}`
    );
    const json = await res.json();
    return Array.isArray(json?.candles) ? json.candles : [];
  }

  subscribeToTick(
    symbol: string,
    interval: string,
    onCandle: (c: Candle) => void,
    onTick: (t: TickPayload) => void
  ): () => void {
    // Close any existing connection
    this.wsRef?.close();

    const ws = new WebSocket(`/ws/binance?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
    this.wsRef = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "candle" && msg.candle) onCandle(msg.candle);
        if (msg.type === "tick")   onTick({ price: msg.price, bid: msg.bid, ask: msg.ask, spread: msg.ask - msg.bid });
      } catch {}
    };

    return () => { ws.close(); this.wsRef = null; };
  }

  subscribeOrderBook(
    symbol: string,
    _depth: number,
    onUpdate: (bids: OrderBookLevel[], asks: OrderBookLevel[]) => void
  ): () => void {
    // The server embeds bids/asks in every tick message on the main feed socket.
    // There is no separate /ws/binance/depth endpoint — read from the main path.
    const ws = new WebSocket(`/ws/binance?symbol=${encodeURIComponent(symbol)}&interval=1`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "tick" && Array.isArray(msg.bids) && Array.isArray(msg.asks)) {
          onUpdate(msg.bids, msg.asks);
        }
      } catch {}
    };
    return () => ws.close();
  }

  async fetchFunds(): Promise<FundsSnapshot> {
    const res  = await fetch("/api/binance/funds");
    const json = await res.json();
    return {
      equity:           json?.data?.totalWalletBalance     ?? 0,
      availableMargin:  json?.data?.availableBalance        ?? 0,
      usedMargin:       json?.data?.totalInitialMargin      ?? 0,
      currency:         "$",
    };
  }

  async fetchPositions(): Promise<any[]> {
    const res  = await fetch("/api/binance/positions");
    const json = await res.json();
    return json?.data ?? [];
  }

  async fetchOrders(): Promise<any[]> {
    const res  = await fetch("/api/binance/orders");
    const json = await res.json();
    return json?.data ?? [];
  }
}
