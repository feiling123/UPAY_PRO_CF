import type { ChainTransfer, Env } from "../types";
import { getCurrency } from "../lib/currencies";
import { Store } from "../lib/store";

interface EtherscanResponse {
  status: string;
  message: string;
  result: Array<{
    timeStamp: string;
    hash: string;
    to: string;
    value: string;
    tokenSymbol: string;
    tokenDecimal: string;
    transactionIndex?: string;
  }>;
}

interface TronScanResponse {
  token_transfers?: Array<{
    transaction_id: string;
    block_ts: number;
    to_address: string;
    quant: string;
    tokenInfo?: { tokenAbbr?: string; tokenDecimal?: number };
    confirmed?: boolean;
  }>;
}

interface TronGridResponse {
  data?: Array<{
    transaction_id: string;
    block_timestamp: number;
    to: string;
    value: string;
    token_info?: { symbol?: string; decimals?: number };
    type?: string;
  }>;
}

export async function scanWalletTransfers(env: Env, currency: string, wallet: string, startMs: number, endMs: number): Promise<ChainTransfer[]> {
  const spec = getCurrency(currency);
  if (!spec) return [];
  if (spec.chain === "tron" && spec.symbol === "TRX") {
    return scanTrx(env, wallet, startMs, endMs);
  }
  if (spec.chain === "tron") {
    return scanTronToken(env, currency, wallet, startMs, endMs);
  }
  return scanEtherscanToken(env, currency, wallet, startMs, endMs);
}

async function scanTronToken(env: Env, currency: string, wallet: string, startMs: number, endMs: number): Promise<ChainTransfer[]> {
  const spec = getCurrency(currency)!;
  const store = new Store(env);
  const tronscanApiKey = await store.getSecure("tronscan_api_key", env.TRONSCAN_API_KEY);
  const trongridApiKey = await store.getSecure("trongrid_api_key", env.TRONGRID_API_KEY);
  const primary = new URL("https://apilist.tronscan.org/api/token_trc20/transfers");
  primary.searchParams.set("toAddress", wallet);
  primary.searchParams.set("limit", "50");
  primary.searchParams.set("confirm", "true");
  primary.searchParams.set("start_timestamp", String(startMs));
  primary.searchParams.set("end_timestamp", String(endMs));
  primary.searchParams.set("contract_address", spec.contract || "");
  const tronscan = await fetch(primary, {
    headers: apiHeader("TRON-PRO-API-KEY", tronscanApiKey)
  });
  if (tronscan.ok) {
    const data = await tronscan.json<TronScanResponse>();
    const transfers = (data.token_transfers || [])
      .filter((tx) => (tx.tokenInfo?.tokenAbbr || "").toUpperCase() === spec.symbol)
      .map((tx) => ({
        txId: tx.transaction_id,
        to: tx.to_address,
        amountUnits: Number(tx.quant),
        timestampMs: tx.block_ts,
        symbol: spec.symbol
      }));
    if (transfers.length) return transfers;
  }

  const fallback = new URL(`https://api.trongrid.io/v1/accounts/${wallet}/transactions/trc20`);
  fallback.searchParams.set("contract_address", spec.contract || "");
  fallback.searchParams.set("limit", "50");
  fallback.searchParams.set("only_confirmed", "true");
  fallback.searchParams.set("min_block_timestamp", String(startMs));
  fallback.searchParams.set("max_block_timestamp", String(endMs));
  const trongrid = await fetch(fallback, {
    headers: apiHeader("TRON-PRO-API-KEY", trongridApiKey)
  });
  if (!trongrid.ok) return [];
  const data = await trongrid.json<TronGridResponse>();
  return (data.data || [])
    .filter((tx) => (tx.token_info?.symbol || "").toUpperCase() === spec.symbol)
    .map((tx) => ({
      txId: tx.transaction_id,
      to: tx.to,
      amountUnits: Number(tx.value),
      timestampMs: tx.block_timestamp,
      symbol: spec.symbol
    }));
}

async function scanTrx(env: Env, wallet: string, startMs: number, endMs: number): Promise<ChainTransfer[]> {
  const tronscanApiKey = await new Store(env).getSecure("tronscan_api_key", env.TRONSCAN_API_KEY);
  const url = new URL("https://apilist.tronscan.org/api/transfer");
  url.searchParams.set("toAddress", wallet);
  url.searchParams.set("limit", "50");
  url.searchParams.set("start_timestamp", String(startMs));
  url.searchParams.set("end_timestamp", String(endMs));
  const response = await fetch(url, { headers: apiHeader("TRON-PRO-API-KEY", tronscanApiKey) });
  if (!response.ok) return [];
  const data = await response.json<{ data?: Array<{ transactionHash: string; timestamp: number; transferToAddress: string; amount: number; tokenName?: string }> }>();
  return (data.data || []).map((tx) => ({
    txId: tx.transactionHash,
    to: tx.transferToAddress,
    amountUnits: Number(tx.amount),
    timestampMs: tx.timestamp,
    symbol: "TRX"
  }));
}

async function scanEtherscanToken(env: Env, currency: string, wallet: string, startMs: number, endMs: number): Promise<ChainTransfer[]> {
  const spec = getCurrency(currency)!;
  const etherscanApiKey = await new Store(env).getSecure("etherscan_api_key", env.ETHERSCAN_API_KEY);
  if (!etherscanApiKey || !spec.chainId || !spec.contract) return [];
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(spec.chainId));
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "tokentx");
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", "50");
  url.searchParams.set("sort", "desc");
  url.searchParams.set("contractaddress", spec.contract);
  url.searchParams.set("address", wallet);
  url.searchParams.set("apikey", etherscanApiKey);
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = await response.json<EtherscanResponse>();
  if (data.status !== "1") return [];
  return data.result
    .map((tx) => ({
      txId: tx.hash,
      to: tx.to,
      amountUnits: decimalValueToSixDecimals(tx.value, Number(tx.tokenDecimal || spec.decimals)),
      timestampMs: Number(tx.timeStamp) * 1000,
      symbol: tx.tokenSymbol
    }))
    .filter((tx) => tx.timestampMs >= startMs && tx.timestampMs <= endMs);
}

function decimalValueToSixDecimals(value: string, decimals: number): number {
  const raw = BigInt(value || "0");
  if (decimals === 6) return Number(raw);
  if (decimals > 6) return Number(raw / 10n ** BigInt(decimals - 6));
  return Number(raw * 10n ** BigInt(6 - decimals));
}

function apiHeader(name: string, value: string | undefined): HeadersInit {
  return value ? { [name]: value } : {};
}
