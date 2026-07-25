import { McpApp, Module, ConfigModule } from '@nitrostack/core';
import { TradesModule } from './modules/trades/trades.module.js';
import { FxModule } from './modules/fx/fx.module.js';
import { SettlementModule } from './modules/settlement/settlement.module.js';
import { InvestigateModule } from './modules/investigate/investigate.module.js';
import { ResolveModule } from './modules/resolve/resolve.module.js';

@McpApp({
  module: AppModule,
  server: {
    name: 'trade-matcher-server',
    version: '1.0.0',
  },
})
@Module({
  name: 'app',
  imports: [ConfigModule.forRoot(), TradesModule, FxModule, SettlementModule, InvestigateModule, ResolveModule],
})
export class AppModule {}