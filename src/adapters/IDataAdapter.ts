// ─────────────────────────────────────────────────────────────────────────────
// IDataAdapter — broker/datasource agnostic contract
// Every broker adapter must implement this interface.
// TradingViewChart only imports from this file — never from a specific adapter.
// ─────────────────────────────────────────────────────────────────────────────

export interface Candle {
  time: number;   // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookLevel {
  price: number;
  qty: number;
  quantity?: number;
  orders?: number;
}

export interface TickPayload {
  price: number;
  bid: number;
  ask: number;
  spread: number;
  bidQty?: number;
  askQty?: number;
}

export interface SymbolDef {
  key: string;        // internal key e.g. "btcusdt", "nifty"
  label: string;      // display name e.g. "BTC/USDT", "NIFTY 50"
  precision: number;  // decimal places for price display
}

export interface IntervalDef {
  key: string;    // e.g. "1", "5", "15"
  label: string;  // e.g. "1m", "5m", "15m"
}

export interface FundsSnapshot {
  equity: number;
  availableMargin: number;
  usedMargin: number;
  currency: string;
}

export interface IDataAdapter {
  // ── Identity ────────────────────────────────────────────────────────────────
  readonly id: string;          // "binance" | "dhanhq" | "coindcx" etc.
  readonly name: string;        // "Binance Futures" | "DhanHQ NSE" etc.
  readonly currency: string;    // "$" | "₹"
  readonly is24x7: boolean;

  // ── Symbol / Interval catalogue ─────────────────────────────────────────────
  getSymbols(): SymbolDef[];
  getIntervals(): IntervalDef[];

  // ── Candle data ─────────────────────────────────────────────────────────────
  fetchCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]>;
  fetchHistoricalCandles(symbol: string, interval: string, fromTs: number, toTs: number): Promise<Candle[]>;

  // ── Live price stream ────────────────────────────────────────────────────────
  // Returns an unsubscribe function.
  subscribeToTick(
    symbol: string,
    interval: string,
    onCandle: (candle: Candle) => void,
    onTick: (tick: TickPayload) => void
  ): () => void;

  // ── Order book (optional) ───────────────────────────────────────────────────
  subscribeOrderBook?(
    symbol: string,
    depth: number,
    onUpdate: (bids: OrderBookLevel[], asks: OrderBookLevel[]) => void
  ): () => void;

  // ── Account data (optional — not all adapters support trading) ───────────────
  fetchFunds?(): Promise<FundsSnapshot>;
  fetchPositions?(): Promise<any[]>;
  fetchOrders?(): Promise<any[]>;
}
