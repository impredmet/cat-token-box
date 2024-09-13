import { Module } from '@nestjs/common';
import { MintCommand } from './commands/mint/mint.command';
import { SendCommand } from './commands/send/send.command';
import { VersionCommand } from './commands/version.command';
import { WalletCommand } from './commands/wallet/wallet.command';
import { ConfigService, SpendService, WalletService } from './providers';
import { RetryQuestions } from './questions/retry-send.question';

@Module({
  imports: [],
  controllers: [],
  providers: [
    WalletService,
    ConfigService,
    SpendService,
    VersionCommand,
    RetryQuestions,
    MintCommand,
    SendCommand,
    ...WalletCommand.registerWithSubCommands(),
  ],
})
export class AppModule {}
