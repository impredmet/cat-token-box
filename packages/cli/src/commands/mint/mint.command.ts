import { Inject } from '@nestjs/common';
import { log } from 'console';
import Decimal from 'decimal.js';
import { Command, Option } from 'nest-commander';
import {
  btc,
  getTokenMinter,
  getTokens,
  getUtxos,
  isOpenMinter,
  logerror,
  needRetry,
  OpenMinterTokenInfo,
  sleep,
  TokenMetadata,
  unScaleByDecimals,
} from 'src/common';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { findTokenMetadataById, scaleConfig } from 'src/token';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import { calcTotalAmount, sendToken } from '../send/ft';
import { broadcastMergeTokenTxs, mergeTokens } from '../send/merge';
import { pickLargeFeeUtxo } from '../send/pick';
import { openMint } from './ft.open-minter';
interface MintCommandOptions extends BoardcastCommandOptions {
  id: string;
  new?: number;
}

@Command({
  name: 'mint',
  description: 'Mint a token',
})
export class MintCommand extends BoardcastCommand {
  constructor(
    @Inject() private readonly spendService: SpendService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(spendService, walletService, configService);
  }

  async getFee() {
    const res = await fetch(
      'https://explorer.unisat.io/fractal-mainnet/api/bitcoin-info/fee',
    );

    const data = await res.json();

    if (!data) {
      return 3;
    }

    return data.data.fastestFee;
  }

  async cat_cli_run(
    passedParams: string[],
    options?: MintCommandOptions,
  ): Promise<void> {
    try {
      if (options.id) {
        const address = this.walletService.getAddress();
        const token = await findTokenMetadataById(
          this.configService,
          options.id,
        );

        if (!token) {
          console.error(`No token found for tokenId: ${options.id}`);
          return;
        }

        const scaledInfo = scaleConfig(token.info as OpenMinterTokenInfo);

        let amount: bigint | undefined;

        if (passedParams[0]) {
          try {
            const d = new Decimal(passedParams[0]).mul(
              Math.pow(10, scaledInfo.decimals),
            );
            amount = BigInt(d.toString());
          } catch (error) {
            logerror(`Invalid amount: "${passedParams[0]}"`, error);
            return;
          }
        }

        if (amount === undefined) {
          console.error('expect an amount');
          return;
        }

        const MAX_RETRY_COUNT = 10;

        for (let index = 0; index < MAX_RETRY_COUNT; index++) {
          await this.merge(token, address);
          const feeUtxos = await this.getFeeUTXOs(address);
          console.log('feeUtxos:', feeUtxos);
          if (feeUtxos.length === 0) {
            console.warn('Insufficient satoshis balance!');
            return;
          }

          console.log(`Minting ${token.info.symbol} tokens ...`);
          const minter = await getTokenMinter(
            amount,
            this.configService,
            this.walletService,
            token,
          );

          if (minter == null) {
            console.log('retrying');
            continue;
          }

          if (isOpenMinter(token.info.minterMd5)) {
            const minterState = minter.state.data;
            if (minterState.isPremined && amount > scaledInfo.limit) {
              console.error('The number of minted tokens exceeds the limit!');
              return;
            }

            const feeRate = await this.getFee();
            console.log('feeRate:', feeRate);
            const mintTxIdOrErr = await openMint(
              this.configService,
              this.walletService,
              this.spendService,
              feeRate,
              feeUtxos,
              token,
              2,
              minter,
              amount,
            );

            if (mintTxIdOrErr instanceof Error) {
              console.log(mintTxIdOrErr);

              if (needRetry(mintTxIdOrErr)) {
                // throw these error, so the caller can handle it.
                log(`retry to mint token [${token.info.symbol}] ...`);
                await sleep(6);
                continue;
              } else {
                logerror(
                  `mint token [${token.info.symbol}] failed`,
                  mintTxIdOrErr,
                );
                await sleep(6);
                continue;
              }
            }

            console.log(
              `Minting ${unScaleByDecimals(amount, token.info.decimals)} ${token.info.symbol} tokens in txid: ${mintTxIdOrErr} ...`,
            );
            const confirmationMessage =
              await this.checkConfirmation(mintTxIdOrErr);
            console.log(confirmationMessage);
            await sleep(6);
            continue;
          } else {
            throw new Error('unkown minter!');
          }
        }

        console.error(`mint token [${token.info.symbol}] failed`);
      } else {
        throw new Error('expect a ID option');
      }
    } catch (error) {
      logerror('mint failed, ', error);
      await sleep(6);
      console.log('Retry to mint token ...');
      this.cat_cli_run(passedParams, options);
    }
  }

  async checkConfirmation(txid: string) {
    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const response = await fetch(
            `https://explorer.unisat.io/fractal-mainnet/api/transaction/summary?txid=${txid}`,
          );
          const data = await response.json();

          if (data.code === 0 && data.data.confirmations > 0) {
            clearInterval(interval);
            resolve(
              `Transaction ${txid} has ${data.data.confirmations} confirmation(s).`,
            );
          } else {
            console.log({ data });
            console.log(`Still waiting for confirmation on txid: ${txid}...`);
          }
        } catch (error) {
          clearInterval(interval);
          reject(`Error checking confirmations: ${error.message}`);
        }
      }, 1000);
    });
  }

  async merge(metadata: TokenMetadata, address: btc.Addres) {
    const res = await getTokens(this.configService, this.spendService, address);

    if (res !== null) {
      const { contracts: tokenContracts } = res;

      if (tokenContracts.length > 1) {
        const cachedTxs: Map<string, btc.Transaction> = new Map();
        console.info(`Start merging your [${metadata.info.symbol}] tokens ...`);

        const feeUtxos = await this.getFeeUTXOs(address);
        const feeRate = await this.getFee();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const [newTokens, newFeeUtxos, e] = await mergeTokens(
          this.configService,
          this.walletService,
          this.spendService,
          feeUtxos,
          feeRate,
          metadata,
          tokenContracts,
          address,
          cachedTxs,
        );

        if (e instanceof Error) {
          logerror('merge token failed!', e);
          return;
        }

        const feeUtxo = pickLargeFeeUtxo(newFeeUtxos);

        if (newTokens.length > 1) {
          const amountTobeMerge = calcTotalAmount(newTokens);
          const result = await sendToken(
            this.configService,
            this.walletService,
            feeUtxo,
            feeRate,
            metadata,
            newTokens,
            address,
            address,
            amountTobeMerge,
            cachedTxs,
          );
          if (result) {
            await broadcastMergeTokenTxs(
              this.configService,
              this.walletService,
              this.spendService,
              [result.commitTx, result.revealTx],
            );

            console.info(
              `Merging your [${metadata.info.symbol}] tokens in txid: ${result.revealTx.id} ...`,
            );
          }
        }
      }
    }
  }

  @Option({
    flags: '-i, --id [tokenId]',
    description: 'ID of the token',
  })
  parseId(val: string): string {
    return val;
  }

  async getFeeUTXOs(address: btc.Address) {
    let feeUtxos = await getUtxos(address);

    feeUtxos = feeUtxos.filter((utxo) => {
      return this.spendService.isUnspent(utxo);
    });

    if (feeUtxos.length === 0) {
      console.warn('Insufficient satoshis balance!');
      return [];
    }
    return feeUtxos;
  }
}
