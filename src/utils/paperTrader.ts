export type PaperSide = "LONG" | "SHORT";
export type PaperExitReason = "STOP" | "TARGET" | "EOD" | "FLIP" | "MANUAL";

export interface PaperSettings {
  stopPct: number;
  targetPct: number;
}

export interface PaperPosition {
  id: string;
  symbol: string;
  side: PaperSide;
  qty: number;
  entryTime: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  estimatedEntry: boolean;
  lastPrice: number;
  lastTime: number;
  maePct: number;
  mfePct: number;
}

export interface PaperTrade extends PaperPosition {
  exitTime: number;
  exitPrice: number;
  exitReason: PaperExitReason;
  pnl: number;
  returnPct: number;
}

export interface PaperAccount {
  symbol: string;
  cash: number;
  open: PaperPosition | null;
  closed: PaperTrade[];
  startedAt: number;
  totalTrades: number;
  wins: number;
}

export const PAPER_START_EQUITY = 100000;
export const PAPER_POSITION_FRACTION = 0.1;
export const DEFAULT_PAPER_SETTINGS: PaperSettings = { stopPct: 2, targetPct: 4 };

/** Quantity (base units) for a $10,000 notional position at the given entry price. */
export function paperPositionQty(entryPrice: number): number {
  if (entryPrice <= 0) return 0;
  return Number(((PAPER_START_EQUITY * PAPER_POSITION_FRACTION) / entryPrice).toFixed(4));
}

/** Directional PnL per unit of price move: +1 for LONG, -1 for SHORT. */
export function sideMultiplier(side: PaperSide): number {
  return side === "LONG" ? 1 : -1;
}

export function createPaperAccount(symbol: string): PaperAccount {
  return {
    symbol,
    cash: PAPER_START_EQUITY,
    open: null,
    closed: [],
    startedAt: Date.now(),
    totalTrades: 0,
    wins: 0,
  };
}

export function unrealizedPnl(acc: PaperAccount): number {
  if (!acc.open) return 0;
  const { side, qty, entryPrice, lastPrice } = acc.open;
  return Number((sideMultiplier(side) * (lastPrice - entryPrice) * qty).toFixed(2));
}

export function paperEquity(acc: PaperAccount): number {
  return Number((acc.cash + unrealizedPnl(acc)).toFixed(2));
}

export function realizedPnl(acc: PaperAccount): number {
  return Number(acc.closed.reduce((sum, t) => sum + t.pnl, 0).toFixed(2));
}

/** Open a paper futures position (no-op when a position is already open). */
export function openPaperPosition(
  acc: PaperAccount,
  opts: { side: PaperSide; entryPrice: number; estimatedEntry: boolean; now: number }
): PaperAccount {
  if (acc.open || opts.entryPrice <= 0) return acc;
  const { stopPct, targetPct } = DEFAULT_PAPER_SETTINGS;
  const mult = sideMultiplier(opts.side);
  const position: PaperPosition = {
    id: `${acc.symbol}-${opts.side}-${opts.now}`,
    symbol: acc.symbol,
    side: opts.side,
    qty: paperPositionQty(opts.entryPrice),
    entryTime: opts.now,
    entryPrice: opts.entryPrice,
    stopPrice: Number((opts.entryPrice * (1 - mult * (stopPct / 100))).toFixed(2)),
    targetPrice: Number((opts.entryPrice * (1 + mult * (targetPct / 100))).toFixed(2)),
    estimatedEntry: opts.estimatedEntry,
    lastPrice: opts.entryPrice,
    lastTime: opts.now,
    maePct: 0,
    mfePct: 0,
  };
  return { ...acc, open: position };
}

/** Close the open position at the given price. */
export function closePaperPosition(
  acc: PaperAccount,
  exitPrice: number,
  now: number,
  reason: PaperExitReason
): { acc: PaperAccount; trade: PaperTrade | null } {
  if (!acc.open) return { acc, trade: null };
  const open = acc.open;
  const pnl = sideMultiplier(open.side) * (exitPrice - open.entryPrice) * open.qty;
  const trade: PaperTrade = {
    ...open,
    exitTime: now,
    exitPrice,
    exitReason: reason,
    pnl: Number(pnl.toFixed(2)),
    returnPct: Number((sideMultiplier(open.side) * ((exitPrice - open.entryPrice) / open.entryPrice) * 100).toFixed(2)),
  };
  return {
    acc: {
      ...acc,
      cash: Number((acc.cash + pnl).toFixed(2)),
      open: null,
      closed: [...acc.closed, trade],
      totalTrades: acc.totalTrades + 1,
      wins: acc.wins + (pnl > 0 ? 1 : 0),
    },
    trade,
  };
}

/**
 * Mark-to-market the open position; auto-closes on stop/target.
 * Returns the updated account plus the closed trade (if any).
 */
export function markPaperPosition(
  acc: PaperAccount,
  price: number,
  now: number
): { acc: PaperAccount; trade: PaperTrade | null } {
  if (!acc.open || price <= 0) return { acc, trade: null };
  const open = acc.open;
  const returnPct = sideMultiplier(open.side) * ((price - open.entryPrice) / open.entryPrice) * 100;
  const updated: PaperPosition = {
    ...open,
    lastPrice: price,
    lastTime: now,
    maePct: Number(Math.min(open.maePct, returnPct).toFixed(2)),
    mfePct: Number(Math.max(open.mfePct, returnPct).toFixed(2)),
  };
  const stopped =
    (open.side === "LONG" && price <= updated.stopPrice) || (open.side === "SHORT" && price >= updated.stopPrice);
  const targeted =
    (open.side === "LONG" && price >= updated.targetPrice) || (open.side === "SHORT" && price <= updated.targetPrice);
  if (stopped) {
    return closePaperPosition({ ...acc, open: updated }, price, now, "STOP");
  }
  if (targeted) {
    return closePaperPosition({ ...acc, open: updated }, price, now, "TARGET");
  }
  return { acc: { ...acc, open: updated }, trade: null };
}

export function loadPaperAccount(symbol: string): PaperAccount | null {
  try {
    const raw = localStorage.getItem(`binance_paper_${symbol.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as PaperAccount) : null;
  } catch {
    return null;
  }
}

export function savePaperAccount(acc: PaperAccount): void {
  try {
    localStorage.setItem(`binance_paper_${acc.symbol.toLowerCase()}`, JSON.stringify(acc));
  } catch {}
}

export function resetPaperAccount(symbol: string): PaperAccount {
  try {
    localStorage.removeItem(`binance_paper_${symbol.toLowerCase()}`);
  } catch {}
  return createPaperAccount(symbol);
}
