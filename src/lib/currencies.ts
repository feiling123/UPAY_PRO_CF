export interface CurrencySpec {
  code: string;
  symbol: "USDT" | "USDC" | "TRX";
  chain: "tron" | "ethereum" | "polygon" | "bsc" | "arbitrum";
  chainId?: number;
  contract?: string;
  decimals: number;
  logo: string;
}

export const CURRENCIES: Record<string, CurrencySpec> = {
  "USDT-TRC20": {
    code: "USDT-TRC20",
    symbol: "USDT",
    chain: "tron",
    contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    decimals: 6,
    logo: "https://static.tronscan.org/production/logo/usdtlogo.png"
  },
  TRX: {
    code: "TRX",
    symbol: "TRX",
    chain: "tron",
    decimals: 6,
    logo: "https://static.tronscan.org/production/logo/trx.png"
  },
  "USDT-Polygon": {
    code: "USDT-Polygon",
    symbol: "USDT",
    chain: "polygon",
    chainId: 137,
    contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    decimals: 6,
    logo: "https://st.softgamings.com/uploads/USDT-Polygon.png"
  },
  "USDT-BSC": {
    code: "USDT-BSC",
    symbol: "USDT",
    chain: "bsc",
    chainId: 56,
    contract: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
    logo: "https://bscscan.com/token/images/busdt_32.png"
  },
  "USDT-ERC20": {
    code: "USDT-ERC20",
    symbol: "USDT",
    chain: "ethereum",
    chainId: 1,
    contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
    logo: "https://static.tronscan.org/production/logo/usdtlogo.png"
  },
  "USDT-ArbitrumOne": {
    code: "USDT-ArbitrumOne",
    symbol: "USDT",
    chain: "arbitrum",
    chainId: 42161,
    contract: "0xFd086bC7CD5C481DCC9C85ebe478A1C0b69FCbb9",
    decimals: 6,
    logo: "https://static.tronscan.org/production/logo/usdtlogo.png"
  },
  "USDC-ERC20": {
    code: "USDC-ERC20",
    symbol: "USDC",
    chain: "ethereum",
    chainId: 1,
    contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    logo: "https://bscscan.com/token/images/centre-usdc_28.png"
  },
  "USDC-Polygon": {
    code: "USDC-Polygon",
    symbol: "USDC",
    chain: "polygon",
    chainId: 137,
    contract: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    decimals: 6,
    logo: "https://bscscan.com/token/images/centre-usdc_28.png"
  },
  "USDC-BSC": {
    code: "USDC-BSC",
    symbol: "USDC",
    chain: "bsc",
    chainId: 56,
    contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
    logo: "https://bscscan.com/token/images/centre-usdc_28.png"
  },
  "USDC-ArbitrumOne": {
    code: "USDC-ArbitrumOne",
    symbol: "USDC",
    chain: "arbitrum",
    chainId: 42161,
    contract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    logo: "https://bscscan.com/token/images/centre-usdc_28.png"
  }
};

export function getCurrency(code: string): CurrencySpec | undefined {
  return CURRENCIES[code];
}

export function listCurrencyCodes(): string[] {
  return Object.keys(CURRENCIES);
}
