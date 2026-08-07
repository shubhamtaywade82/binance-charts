import { WebSocketServer, WebSocket } from "ws";
import { MarketDataService } from "./market-data.service";
import { BinanceClientService } from "./binance-client.service";
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
  private static depthPollerMap: Map<string, NodeJS.Timeout> = new Map();
  private static depthBySymbol: Map<string, DepthSnapshot> = new Map();
  private static subscriberCounts: Map<string, number> = new Map();

  public static attach(wss: WebSocketServer): void {
    wss.on("connection", (ws: WebSocket) => {
      console.log("🔌 React UI WebSocket client connected");

      let currentSymbolLower: string | null = null;
      let activeConfig = MarketDataService.getSymbolConfig("btcusdt");
      let lastSentPrice: number | null = null;
      let lastDepthSentAt = 0;

      // Decrement reference count and cleanup Binance WebSocket stream if no active clients remain
      const unsubscribeCurrent = () => {
        if (!currentSymbolLower) return;
        const count = (this.subscriberCounts.get(currentSymbolLower) || 1) - 1;
        if (count <= 0) {
          this.subscriberCounts.delete(currentSymbolLower);
          this.cleanupSymbolStream(currentSymbolLower);
        } else {
          this.subscriberCounts.set(currentSymbolLower, count);
        }
        currentSymbolLower = null;
      };

      // Subscribe to symbol and increment reference count
      const subscribeTo = (symbolStr: string) => {
        unsubscribeCurrent();

        activeConfig = MarketDataService.getSymbolConfig(symbolStr);
        const newSymbolLower = activeConfig.id.toLowerCase();
        currentSymbolLower = newSymbolLower;

        const count = (this.subscriberCounts.get(newSymbolLower) || 0) + 1;
        this.subscriberCounts.set(newSymbolLower, count);

        this.ensureBinanceFuturesStreams(newSymbolLower, (livePrice) => {
          activeConfig.basePrice = livePrice;
        });
      };

      const sendTick = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!activeConfig.basePrice) return;
        const currentPrice = activeConfig.basePrice;
        const prevClose = activeConfig.prevClose || currentPrice * 0.99;
        const depth = this.depthBySymbol.get(activeConfig.id.toLowerCase());
        const now = Date.now();

        const priceChanged = currentPrice !== lastSentPrice;
        const depthRefreshed = depth !== undefined && now - lastDepthSentAt > 1000;
        if (!priceChanged && !depthRefreshed) return;

        lastSentPrice = currentPrice;
        lastDepthSentAt = now;

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
            console.log(`📡 WebSocket client subscribed to Binance USD-M futures pair: ${parsed.symbol}`);
            subscribeTo(parsed.symbol);
          }
        } catch (e) {}
      });

      ws.on("close", () => {
        clearInterval(interval);
        unsubscribeCurrent();
        console.log("🔌 React UI WebSocket client disconnected");
      });
    });
  }

  /** Close Binance WS & depth poller when symbol has 0 active client subscribers */
  private static cleanupSymbolStream(symbolLower: string): void {
    console.log(`🧹 Cleaning up Binance stream & depth poller for unused symbol: ${symbolLower}`);
    const bWs = this.binanceWsMap.get(symbolLower);
    if (bWs) {
      try { bWs.close(); } catch (e) {}
      this.binanceWsMap.delete(symbolLower);
    }

    const poller = this.depthPollerMap.get(symbolLower);
    if (poller) {
      clearInterval(poller);
      this.depthPollerMap.delete(symbolLower);
    }

    this.depthBySymbol.delete(symbolLower);
  }

  /** Per symbol: real trade-print WS connection + 1s REST order-book poll */
  private static ensureBinanceFuturesStreams(symbolLower: string, onPrice: (p: number) => void): void {
    if (this.binanceWsMap.has(symbolLower)) return;

    try {
      const streamUrl = `wss://fstream.binance.com/ws/${symbolLower}@trade`;
      const bWs = new WebSocketClient(streamUrl);

      bWs.on("message", (data: any) => {
        try {
          const frame = JSON.parse(data.toString());
          const priceStr = frame.p || frame.data?.p || frame.c || frame.data?.c;
          if (priceStr) {
            const price = parseFloat(priceStr);
            if (price > 0) onPrice(price);
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

    const pollDepth = async () => {
      try {
        const client = BinanceClientService.getBinanceClient();
        const snapshot = await client.futures.market.depth(symbolLower.toUpperCase(), 20);
        const toLevels = (rows: { price: number; qty: number }[]): DepthLevel[] =>
          rows.slice(0, 20).map((r) => ({
            price: r.price,
            quantity: r.qty,
            orders: 1,
          }));
        this.depthBySymbol.set(symbolLower, {
          bids: toLevels(snapshot.bids ?? []),
          asks: toLevels(snapshot.asks ?? []),
        });
      } catch (e) {}
    };

    pollDepth();
    const poller = setInterval(pollDepth, 1000);
    this.depthPollerMap.set(symbolLower, poller);
  }
}
