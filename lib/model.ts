// Token Launch Radar model, version radar-2: one snapshot in, one ranked board out.
//
// What changed from a flat-multiple radar: there is no single base multiple any more.
// Each category earns its own multiple from the snapshot itself. For every category we
// look at the protocols in that same snapshot that already record a token, take their
// market-cap / TVL ratios, winsorise them to [0.02, 2.5] so one tiny-TVL outlier cannot
// drag a whole category, and use the median. A category with fewer than three such
// comparables borrows the pooled median of its family (curators borrow from allocators
// and yield, credit borrows across lending and CDPs, and so on), and a category with no
// family evidence at all falls back to the global median of every comparable. Because
// the multiples are derived when the program runs, a future snapshot re-derives its own
// table: nothing about a protocol name is ever hardcoded, and the same function scores
// every row.
//
//   implied = max(1, round( tvl_usd x category_multiple x growthMult x maturityMult ))
//   growthMult   = 1 + (clamp(change_7d, -60, 120) / 100) x 0.5        -> 0.70 .. 1.60
//   maturityMult = 0.6 + (min(age_days, 1095) / 1095) x 0.4             -> 0.60 .. 1.00
//   age_days is counted from listed_at to the snapshot's as_of; unknown age uses 365.
//
// Coverage: every watchlist slug is always on the board (the floor, never a ceiling).
// Early rows are every other protocol that records no token and passes the same style
// of screen the house watchlist uses: no exchange, bridge, canonical bridge, liquid
// staking, liquid restaking or restaked-BTC category, no version marker at the end of
// the name, no whole word wrapped / staked / staking in the name, and no exchange name
// at the start of the name. There is no early-row cap: if it passes the screen and
// records no token, the radar ranks it. The live-token protocols are kept apart and
// shown with the market's own values, never mixed into the ranked board.
// Language rule: a protocol "records no token" here. A data record is not proof that
// no token exists anywhere; it is what this snapshot says.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  winsor_low: number;
  winsor_high: number;
  min_comparables: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  winsor_low: 0.02,
  winsor_high: 2.5,
  min_comparables: 3,
};

/** The model's version label: the dashboard names it and the board rows carry it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Where a category's multiple came from: its own comparables, its family, or the world. */
export type MultipleSource = 'category' | 'family' | 'global';

/** One category's derived multiple, with the evidence behind it. */
export interface CategoryMultiple {
  category: string;
  family: string | null;
  comparables: number;
  multiple: number;
  source: MultipleSource;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_source: MultipleSource;
    family: string | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  multiple_source: MultipleSource;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Category families for the fallback chain. A family pools close economic cousins. */
export const FAMILIES: Record<string, string[]> = {
  'curator-allocator': ['Risk Curators', 'Onchain Capital Allocator', 'Yield Aggregator', 'Yield', 'Liquidity Manager'],
  credit: ['Lending', 'CDP', 'CDP Manager', 'Collateral Markets', 'Collateral Management', 'Uncollateralized Lending'],
  trading: ['Dexs', 'Derivatives', 'Options', 'Synthetics', 'Interest Rate Derivatives'],
  bridge: ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge'],
  staking: ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Restaked BTC', 'Staking Pool'],
  'real-assets': ['RWA', 'Basis Trading', 'CeDeFi'],
  // Deliberately no family for Chain, Privacy or Indexes: their economics do not pool
  // (a layer-1 chain, a privacy coin and an index product share no valuation logic, and
  // Chain has a single comparable, a winsor-capped outlier). They take the global median.
};

/** The family a category belongs to, or null when it stands alone. */
export function familyOf(category: string | null): string | null {
  if (category === null) return null;
  for (const [family, members] of Object.entries(FAMILIES)) {
    if (members.includes(category)) return family;
  }
  return null;
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list, computed on a sorted copy so runs stay deterministic. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Derive the multiple table from the snapshot's own token comparables.
 * Returns the per-category table (sorted by category name) and the global median.
 */
export function deriveMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { table: CategoryMultiple[]; byCategory: Map<string, CategoryMultiple>; globalMultiple: number } {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = Math.min(model.winsor_high, Math.max(model.winsor_low, p.mcap_usd / p.tvl_usd));
    allRatios.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const globalMultiple = allRatios.length > 0 ? median(allRatios) : 0.2;
  const familyRatios = new Map<string, number[]>();
  for (const [category, ratios] of ratiosByCategory) {
    const family = familyOf(category);
    if (family === null) continue;
    const pooled = familyRatios.get(family) ?? [];
    pooled.push(...ratios);
    familyRatios.set(family, pooled);
  }
  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? 'Other');
  const table: CategoryMultiple[] = [];
  const byCategory = new Map<string, CategoryMultiple>();
  for (const category of [...categories].sort()) {
    const own = ratiosByCategory.get(category) ?? [];
    const family = familyOf(category === 'Other' ? null : category);
    let entry: CategoryMultiple;
    if (own.length >= model.min_comparables) {
      entry = { category, family, comparables: own.length, multiple: round4(median(own)), source: 'category' };
    } else if (family !== null && (familyRatios.get(family) ?? []).length >= model.min_comparables) {
      const pooled = familyRatios.get(family)!;
      entry = { category, family, comparables: pooled.length, multiple: round4(median(pooled)), source: 'family' };
    } else {
      entry = { category, family, comparables: allRatios.length, multiple: round4(globalMultiple), source: 'global' };
    }
    table.push(entry);
    byCategory.set(category, entry);
  }
  return { table, byCategory, globalMultiple: round4(globalMultiple) };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multipliers and the implied value one protocol gets under its category multiple. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, multiple: number, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Whole-word wrapped / staked / staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are products of another protocol, or an exchange itself. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
/** Exchange names a wrapped or staked product often starts with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all in this snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol passes the radar's early screen: pre-token and not a product of another. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest implied value first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const { byCategory } = deriveMultiples(snapshot, model);
  const scored = [...chosen.values()].map((p) => {
    const entry = byCategory.get(p.category ?? 'Other')!;
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, entry.multiple, model);
    return { p, entry, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.entry.multiple,
      multiple_source: s.entry.source,
      family: s.entry.family,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL band. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action (step 2) and weekly qualifying action (step 3). */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { core: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('collateral') || c.includes('uncolateral') || c.includes('uncollateral'))
    return { core: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow no more than 30% against the collateral and keep both sides open`, weekly: `Run one small borrow-and-repay cycle on ${name} so the account shows two-sided use, not a parked deposit` };
  if (c.includes('dex'))
    return { core: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain}, choosing a stable or blue-chip pair, and keep the position open`, weekly: `Make one swap through ${name}'s own router on ${chain}, however small, so the week shows a real trade` };
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('synthetic'))
    return { core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position rather than a directional bet`, weekly: `Place one small trade or adjust the hedge on ${name} so the account stays active for the week` };
  if (c.includes('cdp') || c.includes('stable'))
    return { core: `Mint the stable asset of ${name} against $${capital} of collateral on ${chain}, keeping the collateral ratio comfortably above its minimum`, weekly: `Add or remove a small amount of collateral on ${name} so the position is touched, not forgotten` };
  if (c.includes('curator') || c.includes('allocator'))
    return { core: `Deposit $${capital} into a curated vault of ${name} on ${chain} and keep the vault shares in the farming wallet`, weekly: `Check the vault allocation page of ${name}, then make one small deposit or withdrawal so the week is recorded` };
  if (c.includes('rwa'))
    return { core: `Mint $${capital} of the yield-bearing asset of ${name} on ${chain} and hold it in the farming wallet`, weekly: `Open the holder and rewards page of ${name} and make one small extra mint if the page offers one` };
  if (c.includes('basis'))
    return { core: `Deposit $${capital} into the basis-trading vault of ${name} on ${chain} and keep the position through a full funding cycle`, weekly: `Make one scheduled weekly deposit into ${name}, even a small one, so the streak of activity continues` };
  if (c === 'chain')
    return { core: `Use ${name} as a chain: bridge or transfer $${capital} onto it and make one transaction in a native app`, weekly: `Make several small native transactions on ${name} across the week, not all in one minute` };
  if (c.includes('payment') || c.includes('card'))
    return { core: `Route a real payment or transfer of about $${capital} through ${name} instead of a test click`, weekly: `Make one small real payment through ${name} so the week shows genuine use` };
  if (c.includes('insurance'))
    return { core: `Buy about $${capital} of cover from ${name} on ${chain} for a position you already hold elsewhere`, weekly: `Check the active policy on ${name} and extend it if it is close to expiring` };
  if (c.includes('staking') || c.includes('restak') || c.includes('anchor') || c.includes('btc'))
    return { core: `Stake $${capital} of the staking asset through ${name} on ${chain} and keep the receipt token in the farming wallet`, weekly: `Make one small stake or unstake on ${name} so the position changes during the week` };
  if (c.includes('governance') || c.includes('incentive'))
    return { core: `Deposit $${capital} into an incentivised market of ${name} on ${chain} and vote if a vote is open`, weekly: `Claim any incentive shown on ${name} and cast one vote if a proposal is live` };
  if (c.includes('prediction'))
    return { core: `Fund ${name} with $${capital} and take one position in a market you have actually read`, weekly: `Take one new small position on ${name} in a different market from last week` };
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity'))
    return { core: `Deposit $${capital} into the main vault of ${name} on ${chain} and keep the shares in the farming wallet`, weekly: `Claim the vault reward on ${name} and compound it back into the same vault` };
  if (c.includes('launchpad'))
    return { core: `Register the farming wallet on ${name} and deposit $${capital} toward a live or upcoming pool on ${chain}`, weekly: `Check the launch calendar of ${name} once and join one waitlist or pool step it offers` };
  return { core: `Deposit $${capital} of USDC into the main product of ${name} on ${chain} and keep the position open`, weekly: `Make one qualifying action on ${name}, such as a deposit, a swap or a vote, so the week is recorded` };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived
 * from the protocol's own record (category, first chain, TVL band, age, seven-day
 * change) by this one generator. A sharp seven-day fall changes the sizing words in
 * step 2; a young protocol changes the checking words in step 5. No name is listed.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const { core, weekly } = actionsFor(p, capital, chain);
  const falling = p.change_7d !== null && p.change_7d <= -10;
  const coreText = falling
    ? `${core}. TVL fell ${Math.abs(p.change_7d!).toFixed(1)}% in seven days: start with half the capital and add the rest only after a stable week`
    : core;
  const young = age !== null && age < 180;
  return [
    {
      text: `Set up a fresh farming wallet that holds only the funds this plan uses, keep its seed phrase offline, and verify every link from the official page of ${p.name} itself`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: coreText,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot or epoch`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: young
        ? `Because ${p.name} has run for under 180 days, check its official points, rewards and token announcements twice a week, and claim only from a link the protocol itself publishes`
        : `Before you withdraw, open the points or rewards page of ${p.name} and claim only from the link it publishes`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so the position can be repeated, audited or unwound`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const derived = deriveMultiples(snapshot, model);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: derived.globalMultiple,
    multiples: derived.table,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `duplicate slug ${r.slug}`;
    slugs.add(r.slug);
    if (!snapshotSlugs.has(r.slug)) return `${r.slug} is not a protocol in the snapshot`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
