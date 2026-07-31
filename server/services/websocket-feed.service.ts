import { WebSocketServer, WebSocket } from "ws";
import { MarketDataService } from "./market-data.service";
import WebSocketClient from "ws";

export class WebSocketFeedService {
  private static binanceWsMap: Map<string, WebSocketClient> = new Map();

  public static attach(wss: WebSocketServer): void {
    wss.on("connection", (ws: WebSocket) => {
      console.log("🔌 React UI WebSocket client connected");

      let activeSymbol = "btcusdt";
      let activeConfig = MarketDataService.getSymbolConfig("btcusdt");

      const sendTick = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const currentPrice = activeConfig.basePrice || 95000;
        const prevClose = activeConfig.prevClose || currentPrice * 0.99;

        const jitter = (Math.random() - 0.5) * (currentPrice * 0.0005);
        const price = Number((currentPrice + jitter).toFixed(2));
        const dayChange = Number((price - prevClose).toFixed(2));
        const dayPChange = Number(((dayChange / prevClose) * 100).toFixed(2));

        const step = Math.max(0.01, price * 0.0001);
        const bids = Array.from({ length: 10 }, (_, i) => ({
          price: Number((price - (i + 1) * step).toFixed(2)),
          quantity: Number((Math.random() * 5 + 0.1).toFixed(3)),
          orders: Math.floor(Math.random() * 10) + 1,
        }));
        const asks = Array.from({ length: 10 }, (_, i) => ({
          price: Number((price + (i + 1) * step).toFixed(2)),
          quantity: Number((Math.random() * 5 + 0.1).toFixed(3)),
          orders: Math.floor(Math.random() * 10) + 1,
        }));

        ws.send(
          JSON.stringify({
            type: "tick",
            symbol: activeConfig.name,
            securityId: activeConfig.id,
            ltp: price,
            prevClose,
            change: dayChange,
            pChange: dayPChange,
            volume: activeConfig.dayVolume,
            bids,
            asks,
            timestamp: new Date().toISOString(),
          })
        );
      };

      const interval = setInterval(sendTick, 100);

      ws.on("message", (msg: any) => {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.type === "subscribe" && parsed.symbol) {
            activeSymbol = String(parsed.symbol).toLowerCase();
            activeConfig = MarketDataService.getSymbolConfig(activeSymbol);
            console.log(`📡 WebSocket client subscribed to Binance pair: ${activeConfig.name} (${activeConfig.id})`);
            this.ensureBinanceWsConnection(activeConfig.id.toLowerCase(), (livePrice) => {
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

  private static ensureBinanceWsConnection(symbolLower: string, onPrice: (p: number) => void): void {
    if (this.binanceWsMap.has(symbolLower)) return;

    try {
      const streamUrl = `wss://stream.binance.com:9443/ws/${symbolLower}@trade`;
      const bWs = new WebSocketClient(streamUrl);

      bWs.on("message", (data: any) => {
        try {
          const trade = JSON.parse(data.toString());
          if (trade.p) {
            onPrice(parseFloat(trade.p));
          }
        } catch (e) {}
      });

      bWs.on("error", () => {});
      bWs.on("close", () => {
        this.binanceWsMap.delete(symbolLower);
      });

      this.binanceWsMap.set(symbolLower, bWs);
    } catch (e) {}
  }
}
