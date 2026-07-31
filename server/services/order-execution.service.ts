export interface SpreadLeg {
  securityId: string;
  exchangeSegment: string;
  transactionType: "BUY" | "SELL";
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  price?: number;
  productType: "SPOT" | "MARGIN" | "FUTURES";
}

export class OrderExecutionService {
  private static orders: any[] = [];
  private static positions: any[] = [];

  public static async listOrders(): Promise<any> {
    return this.orders;
  }

  public static async listPositions(): Promise<any> {
    return this.positions;
  }

  public static async getFunds(): Promise<any> {
    return {
      availMargin: 50000.0,
      usedMargin: 12500.0,
      unrealizedPnl: 450.25,
      currency: "USDT",
    };
  }

  public static async getLedger(fromDate?: string, toDate?: string): Promise<any> {
    return [
      { id: "TX-1001", date: fromDate || "2026-07-31", type: "CREDIT", amount: 50000.0, balance: 50000.0, description: "Initial Paper Balance (USDT)" }
    ];
  }

  public static async executeSpreadStrategy(buyLeg: SpreadLeg, sellLeg: SpreadLeg): Promise<any> {
    const buyOrder = {
      orderId: `ORD-${Date.now()}-1`,
      symbol: buyLeg.securityId,
      side: buyLeg.transactionType,
      quantity: buyLeg.quantity,
      price: buyLeg.price || 95000,
      status: "FILLED",
      time: new Date().toISOString(),
    };

    const sellOrder = {
      orderId: `ORD-${Date.now()}-2`,
      symbol: sellLeg.securityId,
      side: sellLeg.transactionType,
      quantity: sellLeg.quantity,
      price: sellLeg.price || 95100,
      status: "FILLED",
      time: new Date().toISOString(),
    };

    this.orders.push(buyOrder, sellOrder);

    return {
      status: "success",
      strategy: "MULTI_LEG_SPREAD",
      hedgeLeg: buyOrder,
      shortLeg: sellOrder,
    };
  }
}
