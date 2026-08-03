import { WebSocketServer, WebSocket } from "ws";
import { MarketDataService } from "./market-data.service";
import WebSocketClient from "ws";

interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

interface DepthSnapshot {
  bids: DepthLevel[];
  asks: DepthLevel[];
}

export class WebSocketFeedService {
  private static binanceWsMap: Map<string, WebSocketClient> = new Map();
  private static depthBySymbol: Map<string, DepthSnapshot> = new Map();

  public static attach(wss: WebSocketServer): void {
    wss.on("connection", (ws: WebSocket) => {
      console.log("🔌 React UI WebSocket client connected");

      let activeConfig = MarketDataService.getSymbolConfig("btcusdt");

      const sendTick = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!activeConfig.basePrice) return;
        const currentPrice = activeConfig.basePrice;
        const prevClose = activeConfig.prevClose || currentPrice * 0.99;
        const depth = this.depthBySymbol.get(activeConfig.id.toLowerCase());

        ws.send(
          JSON.stringify({
            type: "tick",
            symbol: activeConfig.name,
            securityId: activeConfig.id,
            ltp: currentPrice,
            prevClose,
            change: Number((currentPrice - prevClose).toFixed(2)),
            pChange: Number((((currentPrice - prevClose) / prevClose) * 100).toFixed(2)),
            volume: activeConfig.dayVolume,
            bids: depth?.bids || [],
            asks: depth?.asks || [],
            timestamp: new Date().toISOString(),
          })
        );
      };

      const interval = setInterval(sendTick, 100);

      ws.on("message", (msg: any) => {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.type === "subscribe" && parsed.symbol) {
            activeConfig = MarketDataService.getSymbolConfig(parsed.symbol);
            console.log(`📡 WebSocket client subscribed to Binance USD-M futures pair: ${activeConfig.name} (${activeConfig.id})`);
            this.ensureBinanceFuturesStreams(activeConfig.id.toLowerCase(), (livePrice) => {
              activeConfig.basePrice = livePrice;
            });
          }
        } catch (e) {}
      });

      ws.on("close", () => {
        clearInterval(interval);
        console.log("🔌 React UI WebSocket client disconnected");
      });
    });
  }

  /** Single USD-M futures connection per symbol: real trade prints + top-20 order book. */
  private static ensureBinanceFuturesStreams(symbolLower: string, onPrice: (p: number) => void): void {
    if (this.binanceWsMap.has(symbolLower)) return;

    try {
      const streamUrl = `wss://fstream.binance.com/stream?streams=${symbolLower}@trade/${symbolLower}@depth20@100ms`;
      const bWs = new WebSocketClient(streamUrl);

      bWs.on("message", (data: any) => {
        try {
          const frame = JSON.parse(data.toString());
          if (frame.stream === `${symbolLower}@trade` && frame.data?.p) {
            const price = parseFloat(frame.data.p);
            if (price > 0) onPrice(price);
          } else if (frame.stream === `${symbolLower}@depth20@100ms` && frame.data) {
            if (Array.isArray(frame.data.b) && Array.isArray(frame.data.a)) {
              this.applyDepthUpdate(symbolLower, frame.data.b, frame.data.a);
            }
          }
        } catch (e) {}
      });

      bWs.on("error", () => {});
      bWs.on("close", () => {
        this.binanceWsMap.delete(symbolLower);
        this.depthBySymbol.delete(symbolLower);
      });

      this.binanceWsMap.set(symbolLower, bWs);
    } catch (e) {}
  }

  /** Futures depth streams emit incremental depthUpdate rows — merge them into a top-20 display book. */
  private static applyDepthUpdate(symbolLower: string, bidRows: [string, string][], askRows: [string, string][]): void {
    const prev = this.depthBySymbol.get(symbolLower) || { bids: [], asks: [] };
    const merge = (levels: DepthLevel[], rows: [string, string][], ascending: boolean): DepthLevel[] => {
      const map = new Map(levels.map((l) => [l.price, l]));
      for (const [priceStr, qtyStr] of rows) {
        const price = parseFloat(priceStr);
        const qty = parseFloat(qtyStr);
        if (qty > 0) map.set(price, { price, quantity: qty, orders: 1 });
        else map.delete(price);
      }
      const sorted = [...map.values()].sort((a, b) => (ascending ? a.price - b.price : b.price - a.price));
      return sorted.slice(0, 20);
    };
    this.depthBySymbol.set(symbolLower, {
      bids: merge(prev.bids, bidRows, false),
      asks: merge(prev.asks, askRows, true),
    });
  }
}
