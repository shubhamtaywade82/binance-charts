import { BinanceClientService } from "./binance-client.service";
import { BinanceRateLimiter } from "./binance-rate-limiter.service";
import type { KlineInterval } from "binance-client-ts";

export interface SymbolConfig {
  id: string;
  segment: string;
  instrument: string;
  name: string;
  basePrice: number;
  prevClose: number;
  dayVolume: number;
}

export class MarketDataService {
  public static SYMBOL_MAP: Record<string, SymbolConfig> = {
    btcusdt: { id: "BTCUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "Bitcoin / USDT", basePrice: 95000.0, prevClose: 94200.0, dayVolume: 1540200300 },
    ethusdt: { id: "ETHUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "Ethereum / USDT", basePrice: 3300.0, prevClose: 3260.0, dayVolume: 890400100 },
    solusdt: { id: "SOLUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "Solana / USDT", basePrice: 185.5, prevClose: 181.0, dayVolume: 512000400 },
    bnbusdt: { id: "BNBUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "BNB / USDT", basePrice: 650.0, prevClose: 642.5, dayVolume: 230100500 },
    xrpusdt: { id: "XRPUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "XRP / USDT", basePrice: 2.45, prevClose: 2.38, dayVolume: 410200100 },
    dogeusdt: { id: "DOGEUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "Dogecoin / USDT", basePrice: 0.345, prevClose: 0.332, dayVolume: 310500200 },
    adausdt: { id: "ADAUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "Cardano / USDT", basePrice: 0.88, prevClose: 0.85, dayVolume: 120400300 },
    avaxusdt: { id: "AVAXUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "Avalanche / USDT", basePrice: 34.5, prevClose: 33.8, dayVolume: 140300100 },
    nearusdt: { id: "NEARUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "NEAR Protocol / USDT", basePrice: 6.45, prevClose: 6.25, dayVolume: 98000100 },
    linkusdt: { id: "LINKUSDT", segment: "USDT-M", instrument: "PERPETUAL", name: "Chainlink / USDT", basePrice: 21.8, prevClose: 21.2, dayVolume: 105000400 },
  };

  public static getSymbolConfig(symbolKey: string): SymbolConfig {
    const key = (symbolKey || "btcusdt").toLowerCase().replace(/[^a-z0-9]/g, "");
    return this.SYMBOL_MAP[key] || this.SYMBOL_MAP.btcusdt;
  }

  public static mapInterval(intervalStr: string): KlineInterval {
    const normalized = (intervalStr || "15").toLowerCase().trim();
    const map: Record<string, KlineInterval> = {
      "1": "1m", "1m": "1m",
      "3": "3m", "3m": "3m",
      "5": "5m", "5m": "5m",
      "15": "15m", "15m": "15m",
      "30": "30m", "30m": "30m",
      "60": "1h", "1h": "1h", "60m": "1h",
      "2h": "2h", "4h": "4h", "6h": "6h", "8h": "8h", "12h": "12h",
      "d": "1d", "1d": "1d", "day": "1d",
      "3d": "3d", "1w": "1w", "1m_month": "1M",
    };
    return map[normalized] || "15m";
  }

  private static parseKline(k: any): { time: number; open: number; high: number; low: number; close: number; volume: number } {
    if (Array.isArray(k)) {
      return {
        time: Math.floor(Number(k[0]) / 1000),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      };
    }
    return {
      time: Math.floor(Number(k.openTime || Date.now()) / 1000),
      open: Number(k.open ?? 0),
      high: Number(k.high ?? 0),
      low: Number(k.low ?? 0),
      close: Number(k.close ?? 0),
      volume: Number(k.volume ?? 0),
    };
  }

  public static async syncRealBinanceFuturesPrices(): Promise<void> {
    try {
      const client = BinanceClientService.getBinanceClient();
      const primaryKeys = ["btcusdt", "ethusdt", "solusdt", "bnbusdt", "xrpusdt"];

      for (const key of primaryKeys) {
        const config = this.SYMBOL_MAP[key];
        try {
          const ticker: any = await BinanceRateLimiter.execute(() =>
            client.futures.market.ticker24hr(config.id)
          );
          if (ticker && ticker.lastPrice) {
            config.basePrice = Number(parseFloat(ticker.lastPrice).toFixed(4));
            config.prevClose = Number(parseFloat(ticker.prevClosePrice || ticker.openPrice || ticker.lastPrice).toFixed(4));
            config.dayVolume = Number(parseFloat(ticker.volume || "0"));
            console.log(`✅ [Binance USD-M Futures Sync] ${config.name} (${config.id}) -> $${config.basePrice}`);
          }
        } catch (e: any) {
          console.warn(`⚠️ Futures sync notice for ${config.name}:`, e.message);
        }
      }
    } catch (err: any) {
      console.warn("⚠️ Futures sync error:", err.message);
    }
  }

  public static async fetchIntradayCandles(symbolKey: string, intervalStr: string): Promise<any> {
    const client = BinanceClientService.getBinanceClient();
    const config = this.getSymbolConfig(symbolKey);
    const interval = this.mapInterval(intervalStr);

    try {
      const klines: any = await BinanceRateLimiter.execute(() =>
        client.futures.market.klines(config.id, interval, { limit: 500 })
      );

      if (Array.isArray(klines) && klines.length > 0) {
        const candles = klines.map((k: any) => this.parseKline(k));

        const latest = candles[candles.length - 1];
        if (latest && latest.close > 0) {
          config.basePrice = latest.close;
        }

        return { symbol: config.name, securityId: config.id, candles, isMock: false };
      }
    } catch (err: any) {
      console.warn(`⚠️ Intraday API notice for ${config.name}:`, err.message);
    }

    return { symbol: config.name, securityId: config.id, candles: this.generateFallbackCandles(config), isMock: true };
  }

  public static async fetchHistoricalCandles(
    symbolKey: string,
    fromDate?: string,
    toDate?: string,
    intervalStr: string = "15m"
  ): Promise<any> {
    const client = BinanceClientService.getBinanceClient();
    const config = this.getSymbolConfig(symbolKey);
    const interval = this.mapInterval(intervalStr);

    const toObj = toDate ? new Date(toDate) : new Date();
    const fromObj = fromDate ? new Date(fromDate) : new Date(toObj.getTime() - 7 * 86400 * 1000);

    try {
      const klines: any = await BinanceRateLimiter.execute(() =>
        client.futures.market.klines(config.id, interval, {
          startTime: fromObj.getTime(),
          endTime: toObj.getTime(),
          limit: 1000,
        })
      );

      if (Array.isArray(klines) && klines.length > 0) {
        const candles = klines.map((k: any) => this.parseKline(k));

        console.log(`✅ [Historical Intraday] Fetched ${candles.length} ${interval} candles for ${config.name}`);
        return { symbol: config.name, securityId: config.id, candles, isMock: false };
      }
    } catch (err: any) {
      console.warn(`⚠️ Historical API notice for ${config.name}:`, err.message);
    }

    return { symbol: config.name, securityId: config.id, candles: this.generateFallbackCandles(config), isMock: true };
  }

  private static generateFallbackCandles(config: SymbolConfig): any[] {
    const base = config.basePrice || 95000;
    return Array.from({ length: 100 }, (_, i) => {
      const time = Math.floor(Date.now() / 1000) - (100 - i) * 60;
      const drift = Math.sin(i / 5) * (base * 0.005);
      return {
        time,
        open: Number((base + drift - base * 0.001).toFixed(4)),
        high: Number((base + drift + base * 0.003).toFixed(4)),
        low: Number((base + drift - base * 0.003).toFixed(4)),
        close: Number((base + drift).toFixed(4)),
        volume: 100 + i * 5,
      };
    });
  }
}
