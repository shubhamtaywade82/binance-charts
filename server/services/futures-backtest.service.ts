import { MarketDataService } from "./market-data.service";
import { scanSetups } from "../../src/utils/setupScanner";

export interface FuturesBacktestConfig {
  symbol: string;
  interval: string;
  leverage: number;
  initialBalance: number;
  riskPct: number;
  takeProfitR: number;
  stopLossPct: number;
}

export interface FuturesTrade {
  id: string;
  side: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  margin: number;
  pnl: number;
  returnPct: number;
  exitReason: "TAKE_PROFIT" | "STOP_LOSS" | "LIQUIDATION" | "END_OF_DATA";
}

export class FuturesBacktestService {
  public static async runBacktest(config: FuturesBacktestConfig): Promise<any> {
    const symbol = (config.symbol || "btcusdt").toLowerCase();
    const interval = config.interval || "15m";
    const leverage = Math.min(50, Math.max(1, config.leverage || 10));
    const balance = config.initialBalance || 10000;
    const riskPct = (config.riskPct || 2) / 100;
    const tpR = config.takeProfitR || 2.0;
    const slPct = (config.stopLossPct || 1.5) / 100;

    const data = await MarketDataService.fetchHistoricalCandles(symbol, undefined, undefined, interval);
    const candles = data.candles || [];

    if (candles.length < 50) {
      return this.emptyResult(symbol, balance);
    }

    const trades: FuturesTrade[] = [];
    let currentBalance = balance;
    let peakBalance = balance;
    let maxDrawdownPct = 0;
    const equityCurve: { time: number; equity: number }[] = [];

    let inPosition: {
      side: "LONG" | "SHORT";
      entryPrice: number;
      entryTime: number;
      quantity: number;
      margin: number;
      stopPrice: number;
      targetPrice: number;
    } | null = null;

    for (let i = 30; i < candles.length; i++) {
      const bar = candles[i];

      if (inPosition) {
        let closed = false;
        let exitPrice = bar.close;
        let reason: FuturesTrade["exitReason"] = "END_OF_DATA";

        if (inPosition.side === "LONG") {
          if (bar.low <= inPosition.stopPrice) {
            exitPrice = inPosition.stopPrice;
            reason = "STOP_LOSS";
            closed = true;
          } else if (bar.high >= inPosition.targetPrice) {
            exitPrice = inPosition.targetPrice;
            reason = "TAKE_PROFIT";
            closed = true;
          }
        } else {
          if (bar.high >= inPosition.stopPrice) {
            exitPrice = inPosition.stopPrice;
            reason = "STOP_LOSS";
            closed = true;
          } else if (bar.low <= inPosition.targetPrice) {
            exitPrice = inPosition.targetPrice;
            reason = "TAKE_PROFIT";
            closed = true;
          }
        }

        if (closed || i === candles.length - 1) {
          const rawPnl =
            inPosition.side === "LONG"
              ? (exitPrice - inPosition.entryPrice) * inPosition.quantity
              : (inPosition.entryPrice - exitPrice) * inPosition.quantity;

          const pnl = Number(rawPnl.toFixed(2));
          currentBalance += pnl;
          const returnPct = Number(((pnl / inPosition.margin) * 100).toFixed(2));

          trades.push({
            id: `FT-${trades.length + 1}`,
            side: inPosition.side,
            entryTime: inPosition.entryTime,
            exitTime: bar.time,
            entryPrice: inPosition.entryPrice,
            exitPrice,
            quantity: inPosition.quantity,
            margin: inPosition.margin,
            pnl,
            returnPct,
            exitReason: reason,
          });

          inPosition = null;
        }
      } else {
        const windowCandles = candles.slice(0, i + 1);
        const signal = scanSetups({
          lastPrice: bar.close,
          fvg: [], ob: [], structure: [], liquidity: [],
          pd: null, sessions: [], sb: [], ote: null, judas: [], amd: [],
          sd: [], tl: [], cp: [], symbol,
        });

        if (signal.direction === "CE_LONG" || signal.direction === "PE_LONG") {
          const side: "LONG" | "SHORT" = signal.direction === "CE_LONG" ? "LONG" : "SHORT";
          const margin = currentBalance * riskPct;
          const positionSizeUsdt = margin * leverage;
          const quantity = Number((positionSizeUsdt / bar.close).toFixed(4));

          const stopDist = bar.close * slPct;
          const stopPrice = Number(
            (side === "LONG" ? bar.close - stopDist : bar.close + stopDist).toFixed(4)
          );
          const targetPrice = Number(
            (side === "LONG" ? bar.close + stopDist * tpR : bar.close - stopDist * tpR).toFixed(4)
          );

          inPosition = { side, entryPrice: bar.close, entryTime: bar.time, quantity, margin, stopPrice, targetPrice };
        }
      }

      if (currentBalance > peakBalance) peakBalance = currentBalance;
      const dd = ((peakBalance - currentBalance) / peakBalance) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;

      equityCurve.push({ time: bar.time, equity: Number(currentBalance.toFixed(2)) });
    }

    const winners = trades.filter((t) => t.pnl > 0);
    const losers = trades.filter((t) => t.pnl < 0);
    const totalWinPnl = winners.reduce((s, t) => s + t.pnl, 0);
    const totalLossPnl = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));

    return {
      symbol: data.symbol,
      initialBalance: balance,
      finalBalance: Number(currentBalance.toFixed(2)),
      netPnlUsdt: Number((currentBalance - balance).toFixed(2)),
      totalTrades: trades.length,
      winnersCount: winners.length,
      losersCount: losers.length,
      winRatePct: trades.length > 0 ? Number(((winners.length / trades.length) * 100).toFixed(1)) : 0,
      profitFactor: totalLossPnl > 0 ? Number((totalWinPnl / totalLossPnl).toFixed(2)) : totalWinPnl > 0 ? 99 : 0,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      equityCurve,
      trades,
    };
  }

  private static emptyResult(symbol: string, balance: number): any {
    return {
      symbol, initialBalance: balance, finalBalance: balance, netPnlUsdt: 0,
      totalTrades: 0, winnersCount: 0, losersCount: 0, winRatePct: 0,
      profitFactor: 0, maxDrawdownPct: 0, equityCurve: [], trades: [],
    };
  }
}
