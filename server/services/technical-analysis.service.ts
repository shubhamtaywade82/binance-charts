import { MarketDataService } from "./market-data.service";

export class TechnicalAnalysisService {
  public static async computeMultiTimeframeBias(symbolKey: string): Promise<any> {
    const config = MarketDataService.getSymbolConfig(symbolKey);
    const data = await MarketDataService.fetchIntradayCandles(symbolKey, "15m");
    const candles = data.candles || [];

    if (candles.length < 14) {
      return { symbol: config.name, overallBias: "NEUTRAL", score: 50, timeframeBiases: {} };
    }

    const closes = candles.map((c: any) => c.close);
    const lastClose = closes[closes.length - 1];

    let gainSum = 0;
    let lossSum = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gainSum += diff;
      else lossSum += Math.abs(diff);
    }
    const rs = lossSum === 0 ? 100 : gainSum / lossSum;
    const rsi = 100 - 100 / (1 + rs);

    const overallBias = rsi > 60 ? "BULLISH" : rsi < 40 ? "BEARISH" : "NEUTRAL";

    return {
      symbol: config.name,
      lastPrice: lastClose,
      rsi: Number(rsi.toFixed(2)),
      overallBias,
      score: Math.min(100, Math.max(0, Math.round(rsi))),
      timeframeBiases: {
        "5m": rsi > 55 ? "BULLISH" : "NEUTRAL",
        "15m": overallBias,
        "1h": rsi > 50 ? "BULLISH" : "BEARISH",
      },
    };
  }
}
