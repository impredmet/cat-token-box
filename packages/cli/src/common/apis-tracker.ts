import {
  int32,
  OpenMinterState,
  ProtocolState,
  ProtocolStateList,
} from '@cat-protocol/cat-smartcontracts';
import { byteString2Int } from 'scrypt-ts';
import { createOpenMinterState } from 'src/commands/mint/ft.open-minter';
import { Constants } from 'src/constants/constants';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { scaleConfig } from 'src/token';
import { getRawTransaction } from './apis';
import { rpc_getraw_transaction_withvin, rpc_scanxoutset } from './apis-rpc';
import { btc } from './btc';
import { OpenMinterContract, TokenContract } from './contact';
import { logerror } from './log';
import { OpenMinterTokenInfo, TokenMetadata } from './metadata';
import { script2P2TR, toP2tr } from './utils';

export type ContractJSON = {
  utxo: {
    txId: string;
    outputIndex: number;
    script: string;
    satoshis: number;
  };
  txoStateHashes: Array<string>;
  state: any;
};

export type BalanceJSON = {
  blockHeight: number;
  balances: Array<{
    tokenId: string;
    confirmed: string;
  }>;
};

const fetchOpenMinterState = async function (
  config: ConfigService,
  wallet: WalletService,
  metadata: TokenMetadata,
  txId: string,
  vout: number,
): Promise<OpenMinterState | null> {
  const minterP2TR = toP2tr(metadata.minterAddr);
  const tokenP2TR = toP2tr(metadata.tokenAddr);
  const info = metadata.info as OpenMinterTokenInfo;
  const scaledInfo = scaleConfig(info);
  if (txId === metadata.revealTxid) {
    return {
      isPremined: false,
      remainingSupply: scaledInfo.max - scaledInfo.premine,
      tokenScript: tokenP2TR,
    };
  }

  const txhex = await getRawTransaction(config, wallet, txId);
  if (txhex instanceof Error) {
    logerror(`get raw transaction ${txId} failed!`, txhex);
    return null;
  }

  const tx = new btc.Transaction(txhex);

  const REMAININGSUPPLY_WITNESS_INDEX = 16;
  const MINTAMOUNT_WITNESS_INDEX = 6;

  let newMinter = 0;

  for (let i = 0; i < tx.outputs.length; i++) {
    const output = tx.outputs[i];
    if (output.script.toHex() === minterP2TR) {
      newMinter++;
    }
  }
  for (let i = 0; i < tx.inputs.length; i++) {
    const witnesses = tx.inputs[i].getWitnesses();

    if (witnesses.length > 2) {
      const lockingScriptBuffer = witnesses[witnesses.length - 2];
      const { p2tr } = script2P2TR(lockingScriptBuffer);
      if (p2tr === minterP2TR) {
        const mintAmount = byteString2Int(
          witnesses[MINTAMOUNT_WITNESS_INDEX].toString('hex'),
        );

        const preState: OpenMinterState = {
          tokenScript:
            witnesses[REMAININGSUPPLY_WITNESS_INDEX - 2].toString('hex'),
          isPremined:
            witnesses[REMAININGSUPPLY_WITNESS_INDEX - 1].toString('hex') == '01'
              ? true
              : false,
          remainingSupply: byteString2Int(
            witnesses[REMAININGSUPPLY_WITNESS_INDEX].toString('hex'),
          ),
        };

        const { minterStates } = createOpenMinterState(
          mintAmount,
          preState.isPremined,
          preState.remainingSupply,
          metadata,
          newMinter,
        );

        return minterStates[vout - 1] || null;
      }
    }
  }

  return null;
};

export const getTokenMinter = async function (
  mintAmount: int32,
  config: ConfigService,
  wallet: WalletService,
  metadata: TokenMetadata,
): Promise<OpenMinterContract | null> {
  const descriptor = `addr(${metadata.minterAddr})`;
  const scanResult = await rpc_scanxoutset(config, descriptor);

  if (scanResult instanceof Error) {
    logerror(
      `scanxoutset failed for minter: ${metadata.minterAddr}`,
      scanResult,
    );
    return null;
  }

  const utxosGet = scanResult.unspents || [];
  if (utxosGet.length === 0) {
    logerror(`No UTXOs found for minter: ${metadata.minterAddr}`, scanResult);
    return null;
  }

  const utxos = utxosGet.filter((utxo) => utxo.amount === 0.00000331);

  for (const c of utxos) {
    try {
      const txDetails = await rpc_getraw_transaction_withvin(
        config,
        null,
        c.txid,
      );

      const stateHashes = txDetails.vin[0].txinwitness.slice(
        Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET,
        Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET +
          Constants.CONTRACT_OUTPUT_MAX_COUNT,
      );

      const protocolState = ProtocolState.fromStateHashList(
        stateHashes as ProtocolStateList,
      );

      const data = await fetchOpenMinterState(
        config,
        wallet,
        metadata,
        c.txid,
        c.vout,
      );

      if (data === null) {
        throw new Error(
          `fetch open minter state failed, minter: ${metadata.minterAddr}, txId: ${c.txid}`,
        );
      }

      const { splitAmountList } = createOpenMinterState(
        mintAmount,
        data.isPremined,
        data.remainingSupply,
        metadata,
        2,
      );

      if (
        splitAmountList[0] === mintAmount &&
        splitAmountList[1] === mintAmount
      ) {
        return {
          utxo: {
            txId: c.txid,
            outputIndex: c.vout,
            script: c.scriptPubKey,
            satoshis: c.amount * 1e8,
          },
          state: {
            protocolState,
            data,
          },
        } as OpenMinterContract;
      }
    } catch (e) {
      logerror(`Error fetching minter state for: ${metadata.minterAddr}`, e);
      return null;
    }
  }

  console.error('No valid minter found!');
  return null;
};

export const getTokens = async function (
  config: ConfigService,
  spendService: SpendService,
  ownerAddress: string,
): Promise<{
  trackerBlockHeight: number;
  contracts: Array<TokenContract>;
} | null> {
  try {
    const descriptor = `addr(${ownerAddress})`;
    const scanResult = await rpc_scanxoutset(config, descriptor);

    if (scanResult instanceof Error) {
      logerror(`scanxoutset failed:`, scanResult);
      return null;
    }

    const { unspents, height: trackerBlockHeight } = scanResult;

    if (!unspents || unspents.length === 0) {
      logerror(`No unspents found for address: ${ownerAddress}`, unspents);
      return null;
    }

    let contracts: Array<TokenContract> = await Promise.all(
      unspents.map(async (utxo) => {
        const txDetails = await rpc_getraw_transaction_withvin(
          config,
          null,
          utxo.txid,
        );

        const stateHashes =
          txDetails.vin[0].txinwitness.slice(
            Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET,
            Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET +
              Constants.CONTRACT_OUTPUT_MAX_COUNT,
          ) || [];

        const protocolState = ProtocolState.fromStateHashList(
          stateHashes as ProtocolStateList,
        );

        const r: TokenContract = {
          utxo: {
            txId: utxo.txid,
            outputIndex: utxo.vout,
            script: utxo.scriptPubKey,
            satoshis: utxo.amount * 1e8,
          },
          state: {
            protocolState,
            data: {
              ownerAddr: ownerAddress,
              amount: BigInt(utxo.amount * 1e8),
            },
          },
        };

        return r;
      }),
    );

    contracts = contracts.filter((tokenContract) =>
      spendService.isUnspent(tokenContract.utxo),
    );

    if (trackerBlockHeight - spendService.blockHeight() > 100) {
      spendService.reset();
    }

    spendService.updateBlockHeight(trackerBlockHeight);

    return {
      contracts,
      trackerBlockHeight: trackerBlockHeight as number,
    };
  } catch (error) {
    logerror(`Error in getTokens:`, error);
    return null;
  }
};
