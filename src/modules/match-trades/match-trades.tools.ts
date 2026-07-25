import { ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';
import { Trade, Break, MatchTradesOutput } from './match-trades.types.js';

const PRICE_TOLERANCE = 0.01;
const QUANTITY_TOLERANCE = 0;

export class MatchTradesTools {
  @Tool({
    name: 'match_trades',
    description: 'Compare System A and System B trades by symbol and flag breaks where price or quantity differ beyond tolerance',
    inputSchema: z.object({
      systemATrades: z.array(Trade).describe('Trade records from System A'),
      systemBTrades: z.array(Trade).describe('Trade records from System B'),
    }),
    examples: {
      request: { systemATrades: [], systemBTrades: [] },
      response: { breaks: [] },
    },
  })
  async matchTrades(
    input: { systemATrades: Trade[]; systemBTrades: Trade[] },
    ctx: ExecutionContext
  ): Promise<MatchTradesOutput> {
    ctx.logger.info('Matching trades', {
      countA: input.systemATrades.length,
      countB: input.systemBTrades.length,
    });

    const breaks: Break[] = [];
    const matchedBSymbols = new Set<string>();

    for (const tradeA of input.systemATrades) {
      const tradeB = input.systemBTrades.find((t) => t.symbol === tradeA.symbol);

      if (!tradeB) {
        breaks.push({
          breakId: `break-${tradeA.symbol}`,
          tradeA,
          tradeB: null,
          discrepancy: `Trade for ${tradeA.symbol} missing in System B`,
        });
        continue;
      }

      matchedBSymbols.add(tradeB.symbol);

      const priceDiff = Math.abs(tradeA.price - tradeB.price);
      const quantityDiff = Math.abs(tradeA.quantity - tradeB.quantity);

      if (priceDiff > PRICE_TOLERANCE || quantityDiff > QUANTITY_TOLERANCE) {
        const parts: string[] = [];
        if (priceDiff > PRICE_TOLERANCE) {
          parts.push(`price ${tradeA.price} vs ${tradeB.price}`);
        }
        if (quantityDiff > QUANTITY_TOLERANCE) {
          parts.push(`quantity ${tradeA.quantity} vs ${tradeB.quantity}`);
        }
        breaks.push({
          breakId: `break-${tradeA.symbol}`,
          tradeA,
          tradeB,
          discrepancy: `Mismatch on ${tradeA.symbol}: ${parts.join(', ')}`,
        });
      }
    }

    for (const tradeB of input.systemBTrades) {
      if (!matchedBSymbols.has(tradeB.symbol)) {
        breaks.push({
          breakId: `break-${tradeB.symbol}`,
          tradeA: null,
          tradeB,
          discrepancy: `Trade for ${tradeB.symbol} missing in System A`,
        });
      }
    }

    ctx.logger.info('Match complete', { breaksFound: breaks.length });
    return { breaks };
  }
}