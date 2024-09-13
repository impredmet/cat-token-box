import fetch from 'node-fetch-cjs';
import { UTXO } from 'scrypt-ts';

import { ConfigService, WalletService } from 'src/providers';
import {
  rpc_broadcast,
  rpc_getconfirmations,
  rpc_getfeeRate,
  rpc_getrawtransaction,
} from './apis-rpc';
import { btc } from './btc';
import { logerror, logwarn } from './log';

export const getFeeRate = async function (
  config: ConfigService,
  wallet: WalletService,
): Promise<number> {
  if (config.useRpc()) {
    const feeRate = await rpc_getfeeRate(config, wallet.getWalletName());
    if (feeRate instanceof Error) {
      return 2;
    }
    return feeRate;
  }

  const url = `${config.getApiHost()}/api/v1/fees/recommended`;
  const feeRate: any = await fetch(url, config.withProxy())
    .then((res) => {
      if (res.status === 200) {
        return res.json();
      }
      return {};
    })
    .catch((e) => {
      console.error(`fetch feeRate failed:`, e);
      return {};
    });

  if (!feeRate) {
    return 2;
  }

  return Math.max(2, feeRate['fastestFee'] || 1);
};

export const getFractalUtxos = async function (
  config: ConfigService,
  address: btc.Address,
): Promise<UTXO[]> {
  const script = new btc.Script(address).toHex();

  const url = `https://open-api-fractal-testnet.unisat.io/v1/indexer/address/${address}/utxo-data?cursor=0&size=16`;
  const utxos: Array<any> = await fetch(
    url,
    config.withProxy({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.getApiKey()}`,
      },
    }),
  )
    .then(async (res) => {
      const contentType = res.headers.get('content-type');
      if (contentType.includes('json')) {
        return res.json();
      } else {
        throw new Error(
          `invalid http content type : ${contentType}, status: ${res.status}`,
        );
      }
    })
    .then((res: any) => {
      if (res.code === 0) {
        const { data } = res;
        return data.utxo.map((utxo) => {
          return {
            txId: utxo.txid,
            outputIndex: utxo.vout,
            script: utxo.scriptPk || script,
            satoshis: utxo.satoshi,
          };
        });
      } else {
        logerror(`fetch utxos failed:`, new Error(res.msg));
      }
      return [];
    })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .catch((e) => {
      logerror(`fetch utxos failed:`, e);
      return [];
    });
  return utxos.sort((a, b) => a.satoshi - b.satoshi);
};

export const getUtxos = async function (address: btc.Address): Promise<UTXO[]> {
  const res = await fetch(
    `https://mempool.fractalbitcoin.io/api/address/${address}/utxo`,
  );

  if (!res.ok) {
    throw new Error('Failed to fetch UTXOs');
  }

  const script = new btc.Script(address).toHex();

  const utxos = (await res.json()) as {
    txid: string;
    vout: number;
    status: {
      confirmed: boolean;
      block_height: number;
      block_hash: string;
      block_time: number;
    };
    value: number;
  }[];

  const utxosToReturn: UTXO[] = utxos.map((utxo: any) => {
    return {
      txId: utxo.txid,
      outputIndex: utxo.vout,
      script: utxo.script || script,
      satoshis: utxo.value,
    };
  });

  return utxosToReturn.sort((a, b) => a.satoshis - b.satoshis);
};

export const getRawTransaction = async function (
  config: ConfigService,
  wallet: WalletService,
  txid: string,
): Promise<string | Error> {
  if (config.useRpc()) {
    return rpc_getrawtransaction(config, wallet.getWalletName(), txid);
  }
  const url = `${config.getApiHost()}/api/tx/${txid}/hex`;
  return (
    fetch(url, config.withProxy())
      .then((res) => {
        if (res.status === 200) {
          return res.text();
        }
        new Error(`invalid http response code: ${res.status}`);
      })
      .then((txhex: string) => {
        return txhex;
      })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .catch((e: Error) => {
        logerror('getrawtransaction failed!', e);
        return e;
      })
  );
};

export const getConfirmations = async function (
  config: ConfigService,
  txid: string,
): Promise<
  | {
      blockhash: string;
      confirmations: number;
    }
  | Error
> {
  if (config.useRpc()) {
    return rpc_getconfirmations(config, txid);
  }

  logwarn('No supported getconfirmations', new Error());
  return {
    blockhash: '',
    confirmations: -1,
  };
};

export async function broadcast(
  config: ConfigService,
  wallet: WalletService,
  txHex: string,
): Promise<string | Error> {
  return rpc_broadcast(config, wallet.getWalletName(), txHex)
    .then((result) => {
      if (typeof result === 'string' && result.length === 64) {
        return result;
      } else {
        throw new Error(`Invalid transaction ID returned: ${result}`);
      }
    })
    .catch((e) => {
      logerror('broadcast failed!', e);
      return e;
    });
}
