import { BinanceClient } from "binance-client-ts";

export class BinanceClientService {
  private static client: BinanceClient | null = null;

  public static getBinanceClient(): BinanceClient {
    if (!this.client) {
      this.client = new BinanceClient();
    }
    return this.client;
  }
}
