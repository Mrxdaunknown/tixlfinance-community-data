// trigger action comment 3

import { assertType } from 'graphql';

// const to play around with
const FACTOR_VOLUME = 1;
const FACTOR_LIQUIDITY = 2;
const FACTOR_EXCHANGES = 1;
const FACTOR_SUPPLY = 1;
const FACTOR_SOCIAL = 2;

const SCORE_UNDEFINED = 0;
const SCORE_MAX_VALUE = 100;

interface Tokenomics {
  circulating_supply?: number;
  total_supply?: number;
}

interface Asset {
  asset_id: string;
  exchanges_data: AssetExchangeData[];
  tokenomics: Tokenomics;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  slippage_100USD: number;
  slippage_1000USD: number;
  slippage_10000USD: number;
  slippage_100000USD: number;
  slippage_1000000USD: number;
}

interface AssetExchangeData {
  exchange: Exchange;
  quality_score?: 'green' | 'yellow' | 'red';
  slippage_10000USD?: number;
  slippage_100000USD?: number;
  slippage_1000000USD?: number;
}

interface ExchangeScore {
  total_score?: number;
}

interface Exchange {
  coingecko_trust_score?: number;
  exchange_score?: ExchangeScore;
  quality_score?: number;
}

interface Score {
  total_score: number;
  volume_score: number;
  real_liquidity_score: number;
  exchanges_score: number;
  supply_score: number;
  sentiment_score: number;
}

interface SentimentData {
  socialVolumeNormalizationFactor: number;
  weightedSentiment: number;
}

const getSlippage = (asset: Asset, usd: number) =>
  Math.min(
    ...asset.exchanges_data
      .filter((el) => !!el[`slippage_${usd}USD`])
      .map((el) => el[`slippage_${usd}USD`] || 1)
  );

export const getLiquidityScoreFromSlippage = (
  slippage10000Usd: number,
  slippage100000Usd: number,
  slippage1000000Usd: number
) => {
  // Slippage 10,000 and 100,000 (liquidityScoreBase) should result in a range between 0 - 90
  // Slippage 1,000,000 (liquidityScoreTop) is required for a score between 90 - 100

  let liquidityScore = SCORE_UNDEFINED;

  // Slippage 100k is more relevant than 10k slippage
  const slippageFactorBase =
    (slippage10000Usd ?? 0.25) + 1.5 * (slippage100000Usd ?? 0.5);

  let liquidityScoreBase =
    SCORE_MAX_VALUE - (slippageFactorBase ?? 1) * SCORE_MAX_VALUE;
  let liquidityScoreTop = 0;

  if (slippage1000000Usd !== null) {
    liquidityScoreTop =
      SCORE_MAX_VALUE - (slippage1000000Usd ?? 1) * SCORE_MAX_VALUE;
  }

  if (liquidityScoreBase < 0) {
    liquidityScoreBase = 0;
  }

  if (liquidityScoreTop < 0) {
    liquidityScoreTop = 0;
  }

  liquidityScore = liquidityScoreBase * 0.9 + liquidityScoreTop * 0.1;

  if (liquidityScore < 0) {
    liquidityScore = 0;
  }

  return liquidityScore;
};

export const calcLiquidityScore = (
  assetExchangeData: AssetExchangeData
): number => {
  return getLiquidityScoreFromSlippage(
    assetExchangeData.slippage_10000USD!,
    assetExchangeData.slippage_100000USD!,
    assetExchangeData.slippage_1000000USD!
  );
};

export function calcScore(
  asset: Asset,
  sentimentData: SentimentData,
  volumeAthBTC: number,
  volumeBTC: number
): Score {
  let volumeScore = SCORE_UNDEFINED;
  let liquidityScore = SCORE_UNDEFINED;
  let exchangesScore = SCORE_UNDEFINED;
  let socialScore = SCORE_UNDEFINED;
  let supplyScore = SCORE_UNDEFINED;

  // the volume score is defined by
  if (
    asset.market_cap_usd &&
    asset.volume_24h_usd &&
    volumeAthBTC &&
    volumeBTC
  ) {
    if (asset.asset_id === 'bitcoin-btc') {
      volumeScore =
        (asset.volume_24h_usd / (0.8 * volumeAthBTC)) * SCORE_MAX_VALUE;
    } else {
      volumeScore = (asset.volume_24h_usd / volumeBTC) * SCORE_MAX_VALUE;
    }

    volumeScore = Math.min(volumeScore, SCORE_MAX_VALUE);
  }

  if (asset.exchanges_data?.length > 0) {
    // calculate the exchange score according to the quality of exchanges a project is listed on
    exchangesScore = 0;
    asset.exchanges_data
      .filter(
        (exchangeData) => !!exchangeData?.exchange?.exchange_score?.total_score
      )
      .forEach((exchangeData: AssetExchangeData) => {
        exchangesScore += exchangeData.exchange?.exchange_score?.total_score!;
      });
    exchangesScore = exchangesScore / asset.exchanges_data.length;

    // now lets calculate the liquidity score according to the slippage
    liquidityScore = getLiquidityScoreFromSlippage(
      asset.slippage_10000USD,
      asset.slippage_100000USD,
      asset.slippage_1000000USD
    );
  }

  // the social score is calculated by sentiment and reach of this messages - normalized again bitcoin
  if (sentimentData) {
    const baseValue = SCORE_MAX_VALUE / 2;
    const rangeFactor = baseValue / 10;

    // sentiment is a value between -1 and 1
    const sentiment = sentimentData.weightedSentiment;

    // normalizationFactor is a value between 0 and 10
    const normalizationFactor = sentimentData.socialVolumeNormalizationFactor;

    socialScore = baseValue + sentiment * normalizationFactor * rangeFactor;
  }

  // the supply score is determined by comparing the circulating vs the total supply
  if (asset.tokenomics?.circulating_supply && asset.tokenomics?.total_supply) {
    supplyScore =
      (asset.tokenomics?.circulating_supply / asset.tokenomics?.total_supply) *
      SCORE_MAX_VALUE;
  }

  const factorSum =
    FACTOR_VOLUME +
    FACTOR_LIQUIDITY +
    FACTOR_EXCHANGES +
    FACTOR_SUPPLY +
    FACTOR_SOCIAL;
  const totalScore =
    (FACTOR_VOLUME * volumeScore +
      FACTOR_LIQUIDITY * liquidityScore +
      FACTOR_EXCHANGES * exchangesScore +
      FACTOR_SUPPLY * supplyScore +
      FACTOR_SOCIAL * socialScore) /
    factorSum;

  // use Math.round(value * 100) / 100 to ensure 2 decimals
  return {
    total_score: Math.round(totalScore * 100) / 100,
    volume_score: Math.round(volumeScore * 100) / 100,
    real_liquidity_score: Math.round(liquidityScore * 100) / 100,
    exchanges_score: Math.round(exchangesScore * 100) / 100,
    supply_score: Math.round(supplyScore * 100) / 100,
    sentiment_score: Math.round(socialScore * 100) / 100,
  };
}
