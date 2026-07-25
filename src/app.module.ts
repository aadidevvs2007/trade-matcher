import { McpApp, Module, ConfigModule } from '@nitrostack/core';
import { TradesModule } from './modules/trades/trades.module.js';

@McpApp({
  module: AppModule,
  server: {
    name: 'trade-matcher-server',
    version: '1.0.0',
  },
})
@Module({
  name: 'app',
  imports: [ConfigModule.forRoot(), TradesModule],
})
export class AppModule {}