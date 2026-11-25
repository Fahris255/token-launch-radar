// lib/model.ts — Token Radar v6 (radar-5 method, freshly re-derived in-session).
//
// Method (from PREP + V5/V6 notes, re-derived from the snapshot, nothing copied):
//   implied = exp(a + b * ln(TVL) + offset[family])  — LAD log-log curve on the 128
//   priced tokens, plus a shrunk median family offset, capped at +/-0.5, families
//   with fewer than 3 priced members get no offset. Growth and maturity are
//   stated diagnostics only: they do NOT multiply into the implied value.
//   offset = clamp(median(residual) * n / (n + 5), -0.5, +0.5)   (k = 5)
// Families: curator {Risk Curators, Onchain Capital Allocator, Yield Aggregator,
//   Yield}, credit {Lending, CDP, Collateral Markets, Collateral Management},
//   trading {Dexs, Derivatives}, yield {RWA, Basis Trading}; every other
//   category is its own family.
// Gates (same protocol as the method runs them): leave-one-out and walk-forward
//   (K=4 expanding folds by listed_at) on the 128 priced tokens.
// Deterministic: no Date.now / Math.random; the bootstrap uses a seeded PRNG;
//   every ordering has a slug tie-break. Node 22 standard library only.

export type Protocol = {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
};
export type Snapshot = { as_of: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] };

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (!s || typeof s.as_of !== 'string' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new Error('snapshot: expected {as_of, floor_usd, protocols[], watchlist[]}');
  }
  return s;
}

// ---------- small helpers ----------
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}
const round12 = (v: number): number => Math.round(v * 1e12) / 1e12;
const DAY = 86_400_000;
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  return Math.floor((new Date(`${asOf}T00:00:00Z`).getTime() - new Date(`${listedAt}T00:00:00Z`).getTime()) / DAY);
}
export const growthMultiplier = (change7d: number | null): number =>
  1 + (clamp(change7d ?? 0, -60, 120) / 100) * 0.5;
export const maturityMultiplier = (age: number | null): number =>
  0.6 + (Math.min(age ?? 365, 1095) / 1095) * 0.4;

// ---------- families ----------
export const FAMILIES: Record<string, string[]> = {
  curator: ['Risk Curators', 'Onchain Capital Allocator', 'Yield Aggregator', 'Yield'],
  credit: ['Lending', 'CDP', 'Collateral Markets', 'Collateral Management'],
  trading: ['Dexs', 'Derivatives'],
  yield: ['RWA', 'Basis Trading'],
  staking: ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Restaked BTC', 'Staking Pool'],
};
export function familyOf(category: string | null): string {
  if (!category) return 'other';
  for (const [fam, cats] of Object.entries(FAMILIES)) if (cats.includes(category)) return fam;
  return category;
}

// ---------- fitting ----------
// Exact least-absolute-deviation fit of y = a + b*x by Nelder-Mead from the OLS
// start. The LAD objective is convex; the simplex is run to a tight tolerance
// and the result matches a pair-search global optimum on this snapshot.
export function ladFit(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const obj = (a: number, b: number): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.abs(ys[i]! - a - b * xs[i]!);
    return s;
  };
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i]! - mx) ** 2; sxy += (xs[i]! - mx) * (ys[i]! - my); }
  const b0 = sxx === 0 ? 0 : sxy / sxx;
  const a0 = my - b0 * mx;
  let P: Array<[number, number]> = [[a0, b0], [a0 + 0.5, b0], [a0, b0 + 0.05]];
  let V = P.map((p) => obj(p[0], p[1]));
  for (let it = 0; it < 5000; it++) {
    const o = [0, 1, 2].sort((i, j) => V[i]! - V[j]!);
    P = o.map((i) => P[i]!); V = o.map((i) => V[i]!);
    if (Math.abs(V[2]! - V[0]!) < 1e-10) break;
    const cx = (P[0]![0] + P[1]![0]) / 2, cy = (P[0]![1] + P[1]![1]) / 2;
    const rx = cx + (cx - P[2]![0]), ry = cy + (cy - P[2]![1]);
    const rv = obj(rx, ry);
    if (rv < V[0]!) {
      const ex = cx + 2 * (cx - P[2]![0]), ey = cy + 2 * (cy - P[2]![1]);
      const ev = obj(ex, ey);
      if (ev < rv) { P[2] = [ex, ey]; V[2] = ev; } else { P[2] = [rx, ry]; V[2] = rv; }
    } else if (rv < V[1]!) { P[2] = [rx, ry]; V[2] = rv; }
    else {
      const kx = cx + 0.5 * (P[2]![0] - cx), ky = cy + 0.5 * (P[2]![1] - cy);
      const kv = obj(kx, ky);
      if (kv < V[2]!) { P[2] = [kx, ky]; V[2] = kv; }
      else {
        for (let i = 1; i < 3; i++) {
          P[i] = [(P[i]![0] + P[0]![0]) / 2, (P[i]![1] + P[0]![1]) / 2];
          V[i] = obj(P[i]![0], P[i]![1]);
        }
      }
    }
  }
  const o = [0, 1, 2].sort((i, j) => V[i]! - V[j]!);
  return { a: P[o[0]!]![0], b: P[o[0]!]![1] };
}
export function olsFit(xs: number[], ys: number[]): { a: number; b: number } {
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) { sxx += (xs[i]! - mx) ** 2; sxy += (xs[i]! - mx) * (ys[i]! - my); }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

// Shrunk median family offsets under a fitted curve. k = 5 (the shrinkage
// constant); families with fewer than 3 priced members get offset 0.
export function familyOffsets(pts: Protocol[], fit: { a: number; b: number }): Record<string, number> {
  const by: Record<string, number[]> = {};
  for (const p of pts) {
    const r = Math.log(p.mcap_usd!) - (fit.a + fit.b * Math.log(p.tvl_usd));
    (by[familyOf(p.category)] ??= []).push(r);
  }
  const off: Record<string, number> = {};
  for (const [fam, rs] of Object.entries(by)) {
    off[fam] = rs.length >= 3 ? clamp(median(rs) * rs.length / (rs.length + 5), -0.5, 0.5) : 0;
  }
  return off;
}

export const pricedOf = (snap: Snapshot): Protocol[] =>
  snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);

// ---------- rankable (house-style exclusions, full) ----------
const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
export function rankable(p: Protocol): boolean {
  if (!(p.gecko_id === null && p.symbol === null)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_RE.test(p.name)) return false;
  if (WRAPPED_RE.test(p.name)) return false;
  return true;
}

// ---------- farm plan ----------
// Capital by TVL band (M = miliar/billion): >=$5B $250, >=$1B $150, >=$100M $100, else $50.
// Hold by age: <180 days 60 days, <365 days 45 days, else 30 days.
export const capitalFor = (tvl: number): number => (tvl >= 5e9 ? 250 : tvl >= 1e9 ? 150 : tvl >= 1e8 ? 100 : 50);
export const holdFor = (age: number | null): number => {
  const a = age ?? 365;
  return a < 180 ? 60 : a < 365 ? 45 : 30;
};
const CORE_ACTION: Record<string, [string, string]> = {
  'Lending': ['Supply USDC, then borrow up to 30% of the collateral', 'Run one small borrow-repay cycle'],
  'Collateral Markets': ['Supply USDC, then borrow up to 30% of the collateral', 'Run one small borrow-repay cycle'],
  'Dexs': ['Provide liquidity in the main pool on a stable or bluechip pair', 'Make one swap through the protocol router'],
  'Derivatives': ['Deposit USDC margin and open one small hedge', 'Make one small trade or adjust the hedge'],
  'CDP': ['Mint the stablecoin against collateral and hold the position', 'Add or remove a small amount of collateral'],
  'Stablecoin Wrapper': ['Mint the stablecoin against collateral and hold the position', 'Add or remove a small amount of collateral'],
  'Yield': ['Deposit into the main vault', 'Claim and compound the reward'],
  'Yield Aggregator': ['Deposit into the main vault', 'Claim and compound the reward'],
  'Risk Curators': ['Deposit into the curated vault on the main chain', 'Check the vault allocation and make one small deposit or withdrawal'],
  'Onchain Capital Allocator': ['Deposit into the curated vault on the main chain', 'Check the vault allocation and make one small deposit or withdrawal'],
  'RWA': ['Mint the yield-bearing RWA asset and hold it', 'Check the holder and rewards page and make one small mint'],
  'Basis Trading': ['Deposit into the basis and delta-neutral vault', 'Make one scheduled weekly deposit'],
  'Chain': ['Use the chain: one transfer plus one dApp transaction', 'Make a few native transactions'],
  'Payments': ['Make a payment or transfer through the protocol', 'Make one small real payment'],
  'Insurance': ['Buy cover for a position you already hold', 'Extend or check the active policy'],
  'Restaking': ['Stake the asset and keep the receipt token', 'Make one small stake or unstake'],
  'Staking Pool': ['Stake the asset and keep the receipt token', 'Make one small stake or unstake'],
  'Governance Incentives': ['Deposit into the incentivised market and vote if a vote is open', 'Claim the incentive and cast one vote'],
  'Prediction Market': ['Fund the account and take one market position', 'Take one small new position'],
};
const DEFAULT_ACTION: [string, string] = ['Deposit USDC into the protocol’s main product', 'Make one generic qualifying action (deposit, swap or vote)'];

export function farmSteps(p: Protocol, asOf: string): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const age = ageDays(p.listed_at, asOf);
  const hold = holdFor(age);
  const [core, weekly] = CORE_ACTION[p.category ?? ''] ?? DEFAULT_ACTION;
  const cautious = (p.change_7d !== null && p.change_7d <= -10)
    ? ` TVL fell ${Math.abs(p.change_7d).toFixed(2)}% in 7 days: start with half the capital and add the rest after a week of stability.`
    : '';
  const young = (age !== null && age < 180)
    ? ' The protocol is under 180 days tokenless: check its token and points announcements twice a week.'
    : '';
  const steps = [
    `Set up a fresh farming wallet holding only the planned $${capital}; keep its seed offline and verify every link from the protocol’s own page before connecting. Cost: $0. Time: ~15 min once.`,
    `${core} on ${chain} with $${capital} of capital.${cautious} Cost: $${capital} capital + ~$10 gas. Time: ~20 min once.`,
    `Each week, ${weekly.toLowerCase()} to keep the position active. Cost: ~$2 gas. Time: ~10 min/week.`,
    `Hold the position for ${hold} days so the activity spans more than one snapshot and epoch. Cost: $0. Time: ${hold} days.`,
    `Open the protocol’s official points or rewards page and claim only through links the protocol itself publishes; never pay to claim.${young} Cost: ~$3 gas. Time: ~10 min once.`,
    `Record the wallet, the date and every transaction in a farm log so the position can be repeated or unwound. Cost: $0. Time: ~5 min once.`,
    `Each week, review the position against the radar: if TVL falls a further 10% or the protocol announces a token, reassess before adding more. Cost: $0. Time: ~5 min/week.`,
  ];
  return steps;
}

// Net a plan's Cost/Time strings into chips. Weekly gas is charged for every
// week of the hold (weeks = round(holdDays / 7)); weekly minutes add up.
export function netPlan(steps: string[]): { capital: number; gas: number; weeklyMin: number; holdDays: number } {
  let capital = 0, gas = 0, weeklyMin = 0, holdDays = 0;
  let weeklyGas = 0;
  for (const s of steps) {
    const cost = s.match(/Cost: ([^.]+)\./)?.[1] ?? '';
    const time = s.match(/Time: ([^.]+)\./)?.[1] ?? '';
    const capM = cost.match(/\$(\d+(?:\.\d+)?)\s*capital/);
    if (capM) capital += Number(capM[1]);
    const gasM = [...cost.matchAll(/~?\$(\d+(?:\.\d+)?)\s*gas/g)];
    const isWeekly = /\/week/.test(time);
    for (const g of gasM) {
      if (isWeekly) weeklyGas += Number(g[1]);
      else gas += Number(g[1]);
    }
    const minM = time.match(/~?(\d+)\s*min\/week/);
    if (minM) weeklyMin += Number(minM[1]);
    const dayM = time.match(/(\d+)\s*days?/);
    if (dayM) holdDays = Number(dayM[1]);
  }
  const weeks = Math.round(holdDays / 7);
  return { capital, gas: Math.round((gas + weeklyGas * weeks) * 100) / 100, weeklyMin, holdDays };
}

// ---------- peer cross-check ----------
// Peer set: the row's category when it has >= 3 priced tokens, else its family
// when that has >= 3, else all priced tokens. Multiple = median mcap/TVL.
export function peerSet(priced: Protocol[], category: string | null): { n: number; multiple: number } {
  const fam = familyOf(category);
  const inCat = category === null ? [] : priced.filter((p) => p.category === category);
  const inFam = priced.filter((p) => familyOf(p.category) === fam);
  const set = inCat.length >= 3 ? inCat : inFam.length >= 3 ? inFam : priced;
  return { n: set.length, multiple: median(set.map((p) => p.mcap_usd! / p.tvl_usd)) };
}

// ---------- gates ----------
export function looGate(priced: Protocol[]): number {
  let err = 0;
  for (let i = 0; i < priced.length; i++) {
    const rest = priced.filter((_, j) => j !== i);
    const fit = ladFit(rest.map((p) => Math.log(p.tvl_usd)), rest.map((p) => Math.log(p.mcap_usd!)));
    const off = familyOffsets(rest, fit);
    const p = priced[i]!;
    const pred = fit.a + fit.b * Math.log(p.tvl_usd) + (off[familyOf(p.category)] ?? 0);
    err += Math.abs(pred - Math.log(p.mcap_usd!));
  }
  return err / priced.length;
}
export function wfGate(priced: Protocol[]): { value: number; folds: Array<{ train: number; test: number; mae: number; from: string; to: string }> } {
  const dated = priced.filter((p) => p.listed_at).sort((a, b) =>
    a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1);
  const K = 4;
  const folds: Array<{ train: number; test: number; mae: number; from: string; to: string }> = [];
  let err = 0, cnt = 0;
  for (let k = 1; k < K; k++) {
    const cut = Math.floor(dated.length * k / K);
    const next = Math.floor(dated.length * (k + 1) / K);
    const train = dated.slice(0, cut), test = dated.slice(cut, next);
    const fit = ladFit(train.map((p) => Math.log(p.tvl_usd)), train.map((p) => Math.log(p.mcap_usd!)));
    const off = familyOffsets(train, fit);
    let fe = 0;
    for (const p of test) {
      fe += Math.abs(fit.a + fit.b * Math.log(p.tvl_usd) + (off[familyOf(p.category)] ?? 0) - Math.log(p.mcap_usd!));
    }
    err += fe; cnt += test.length;
    folds.push({ train: train.length, test: test.length, mae: fe / test.length, from: train[train.length - 1]!.listed_at!, to: test[test.length - 1]!.listed_at! });
  }
  return { value: err / cnt, folds };
}

// ---------- deterministic bootstrap (mulberry32) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Refit on bootstrap resamples of the priced set; rank range per board row.
// The range is the central 80% (10th-90th percentile) of the bootstrap ranks:
// the min-max over resamples is dominated by single extreme refits, while the
// central interval is what a reader can actually use.
export function bootstrapRankRanges(
  priced: Protocol[], boardProtos: Protocol[], fit: { a: number; b: number }, off: Record<string, number>,
  replicates = 40, seed = 0x5eed,
): Map<string, [number, number]> {
  const rnd = mulberry32(seed);
  const all = new Map<string, number[]>();
  for (let r = 0; r < replicates; r++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < priced.length; i++) sample.push(priced[Math.floor(rnd() * priced.length)]!);
    const f = ladFit(sample.map((p) => Math.log(p.tvl_usd)), sample.map((p) => Math.log(p.mcap_usd!)));
    const o = familyOffsets(sample, f);
    const vals = boardProtos.map((p) => ({
      slug: p.slug,
      v: Math.exp(f.a + f.b * Math.log(p.tvl_usd) + (o[familyOf(p.category)] ?? 0)),
    })).sort((x, y) => y.v - x.v || (x.slug < y.slug ? -1 : 1));
    vals.forEach((row, idx) => {
      (all.get(row.slug) ?? all.set(row.slug, []).get(row.slug)!)!.push(idx + 1);
    });
  }
  const pct = (arr: number[], q: number): number => {
    const s = [...arr].sort((a, b) => a - b);
    const i = (s.length - 1) * q;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
  };
  const ranges = new Map<string, [number, number]>();
  for (const [slug, arr] of all) {
    ranges.set(slug, [Math.round(pct(arr, 0.10)), Math.round(pct(arr, 0.90))]);
  }
  return ranges;
}

// ---------- board row ----------
export type BoardRow = {
  slug: string; name: string; category: string | null; family: string; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null; token_status: 'pre-token';
  age_days: number | null; set: 'watchlist' | 'early';
  rank: number; implied_value_usd: number;
  model: { base_multiple: number; growth_pct: number | null; growth_multiplier: number; maturity_multiplier: number; age_days: number | null };
  offset: number; offset_factor: number; curve_value: number;
  peer: { n: number; multiple: number; value: number };
  ls_value: number; percentile: number;
  rank_lo: number; rank_hi: number;
  scenario_lo: number; scenario_hi: number;
  cat_median_implied: number; cat_median_tvl: number; mult_implied: number; mult_tvl: number;
  farm_steps: string[];
};

export type Radar = {
  meta: {
    as_of: string; floor_usd: number; protocols: number; priced: number;
    pre_token: number; token_recorded_mcap_null: number; board_rows: number;
    watchlist: number; early_rows: number; model: string;
  };
  curve: { a: number; b: number };
  ols: { a: number; b: number };
  offsets: Record<string, number>;
  offset_factors: Record<string, number>;
  family_members: Record<string, number>;
  gates: { loo: number; wf: number; loo_ref: number; wf_ref: number; loo_log10: number };
  band: [number, number];
  wf_folds: Array<{ train: number; test: number; mae: number; from: string; to: string }>;
  rows: BoardRow[];
  skip: Array<{ slug: string; name: string; rank: number; reasons: string[] }>;
  universe: { total: number; priced: number; token_recorded_mcap_null: number; pre_token: number; rankable: number; watchlist: number; early: number };
  signals: { tvl: number; change_7d: number; change_7d_null: number; listed_at: number; listed_at_null: number; capped_offset_rows: number; no_offset_rows: number };
  anchors: Array<{ slug: string; name: string; family: string; predicted: number; actual: number; ratio: number }>;
  generic: { peer_top: number; peer_top_x: number; mult_under_50m: number; mult_over_250m: number; rain_tvl: number; rain_mcap: number; rain_x: number };
  top5: string[];
};

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const priced = pricedOf(snapshot);
  const xs = priced.map((p) => Math.log(p.tvl_usd));
  const ys = priced.map((p) => Math.log(p.mcap_usd!));
  const fit = ladFit(xs, ys);
  const ols = olsFit(xs, ys);
  const off = familyOffsets(priced, fit);
  const loo = looGate(priced);
  const wf = wfGate(priced);

  // Scenario band: 20th-80th percentile of actual / model-implied over the priced set.
  const ratios = priced.map((p) => {
    const pred = Math.exp(fit.a + fit.b * Math.log(p.tvl_usd) + (off[familyOf(p.category)] ?? 0));
    return p.mcap_usd! / pred;
  }).sort((a, b) => a - b);
  const pct = (q: number): number => {
    const i = (ratios.length - 1) * q;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return ratios[lo]! + (ratios[hi]! - ratios[lo]!) * (i - lo);
  };
  const band: [number, number] = [pct(0.20), pct(0.80)];

  // Board: every watchlist slug + every rankable non-watchlist protocol (198 total).
  const watch = new Set(snapshot.watchlist);
  const protos = snapshot.protocols.filter((p) => rankable(p) || watch.has(p.slug));
  const early = protos.filter((p) => !watch.has(p.slug)).sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const wlRows = snapshot.watchlist.map((s) => snapshot.protocols.find((p) => p.slug === s)!).filter(Boolean);
  const ordered = [...wlRows, ...early];
  const ranges = bootstrapRankRanges(priced, ordered, fit, off);

  // Category medians over ALL snapshot protocols in the category (implied + TVL).
  const catGroups = new Map<string, Protocol[]>();
  for (const p of snapshot.protocols) {
    if (p.category === null) continue;
    (catGroups.get(p.category) ?? catGroups.set(p.category, []).get(p.category)!)!.push(p);
  }
  const impliedOf = (p: Protocol): number => Math.exp(fit.a + fit.b * Math.log(p.tvl_usd) + (off[familyOf(p.category)] ?? 0));
  const catMedian = new Map<string, { implied: number; tvl: number }>();
  for (const [cat, ps] of catGroups) {
    catMedian.set(cat, { implied: median(ps.map(impliedOf)), tvl: median(ps.map((p) => p.tvl_usd)) });
  }

  const rows: BoardRow[] = ordered.map((p) => {
    const fam = familyOf(p.category);
    const offset = off[fam] ?? 0;
    const offsetFactor = Math.exp(offset);
    const curveValue = Math.exp(fit.a + fit.b * Math.log(p.tvl_usd));
    const implied = Math.max(1, Math.round(curveValue * offsetFactor));
    const age = ageDays(p.listed_at, snapshot.as_of);
    const peer = peerSet(priced, p.category);
    const peerValue = Math.max(1, Math.round(peer.multiple * p.tvl_usd));
    const lsValue = Math.max(1, Math.round(Math.exp(ols.a + ols.b * Math.log(p.tvl_usd)) * offsetFactor));
    const below = priced.filter((q) => q.mcap_usd! < implied).length;
    const percentile = Math.round((100 * below) / priced.length * 10) / 10;
    const [rankLo, rankHi] = ranges.get(p.slug) ?? [0, 0];
    const cm = p.category === null ? { implied: 0, tvl: 0 } : catMedian.get(p.category) ?? { implied: 0, tvl: 0 };
    return {
      slug: p.slug, name: p.name, category: p.category, family: fam, chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at,
      gecko_id: p.gecko_id, symbol: p.symbol, token_status: 'pre-token',
      age_days: age, set: watch.has(p.slug) ? 'watchlist' : 'early',
      rank: 0, implied_value_usd: implied,
      model: {
        base_multiple: round12(curveValue / p.tvl_usd),
        growth_pct: p.change_7d,
        growth_multiplier: round12(growthMultiplier(p.change_7d)),
        maturity_multiplier: round12(maturityMultiplier(age)),
        age_days: age,
      },
      offset: round12(offset), offset_factor: round12(offsetFactor), curve_value: Math.round(curveValue),
      peer: { n: peer.n, multiple: round12(peer.multiple), value: peerValue },
      ls_value: lsValue, percentile,
      rank_lo: rankLo, rank_hi: rankHi,
      scenario_lo: Math.max(1, Math.round(implied * band[0])), scenario_hi: Math.max(1, Math.round(implied * band[1])),
      cat_median_implied: Math.round(cm.implied), cat_median_tvl: Math.round(cm.tvl),
      mult_implied: cm.implied > 0 ? round12(implied / cm.implied) : 0,
      mult_tvl: cm.tvl > 0 ? round12(p.tvl_usd / cm.tvl) : 0,
      farm_steps: farmSteps(p, snapshot.as_of),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });

  // Skip list: three steepest weekly TVL falls >= 20%, plus the three
  // lowest-ranked rows carrying 2+ defects (double-digit weekly fall, peer
  // cross-check on <= 3 comparables, under 90 days tokenless, family offset
  // pinned at the +/-0.5 cap). Reasons from each row's own figures.
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const falls = rows.filter((r) => r.change_7d !== null && r.change_7d <= -20)
    .sort((a, b) => a.change_7d! - b.change_7d! || (a.slug < b.slug ? -1 : 1)).slice(0, 3);
  const defects = (r: BoardRow): string[] => {
    const d: string[] = [];
    if (r.change_7d !== null && r.change_7d <= -10) d.push(`TVL fell ${Math.abs(r.change_7d).toFixed(2)}% in seven days`);
    if (r.peer.n <= 3) d.push(`peer cross-check on ${r.peer.n} comparable${r.peer.n === 1 ? '' : 's'}`);
    if (r.age_days !== null && r.age_days < 90) d.push(`${r.age_days} days tokenless`);
    if (Math.abs(r.offset) >= 0.5) d.push(`family offset pinned at the ±0.5 cap (×${r.offset_factor.toFixed(2)})`);
    return d;
  };
  const defective = rows.filter((r) => !falls.includes(r) && defects(r).length >= 2)
    .sort((a, b) => b.rank - a.rank).slice(0, 3);
  const skip = [...falls, ...defective].map((r) => {
    const reasons: string[] = [];
    if (r.change_7d !== null && r.change_7d <= -20) reasons.push(`TVL fell ${Math.abs(r.change_7d).toFixed(2)}% in seven days`);
    for (const d of defects(r)) {
      if (r.change_7d !== null && r.change_7d <= -20 && d.startsWith('TVL fell')) continue;
      reasons.push(d);
    }
    if (r.change_7d !== null && r.change_7d <= -20 && reasons.length === 0) reasons.push(`TVL fell ${Math.abs(r.change_7d).toFixed(2)}% in seven days`);
    return { slug: r.slug, name: r.name, rank: r.rank, reasons };
  });

  // Universe accounting.
  const preToken = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null && p.mcap_usd === null);
  const tokenNoMcap = snapshot.protocols.filter((p) => !(p.gecko_id === null && p.symbol === null && p.mcap_usd === null) && !(p.mcap_usd !== null && p.mcap_usd > 0));
  const rankableCount = snapshot.protocols.filter((p) => rankable(p)).length;

  // Signal accounting over the board.
  const signals = {
    tvl: rows.length,
    change_7d: rows.filter((r) => r.change_7d !== null).length,
    change_7d_null: rows.filter((r) => r.change_7d === null).length,
    listed_at: rows.filter((r) => r.listed_at !== null).length,
    listed_at_null: rows.filter((r) => r.listed_at === null).length,
    capped_offset_rows: rows.filter((r) => Math.abs(r.offset) >= 0.5).length,
    no_offset_rows: rows.filter((r) => r.offset === 0).length,
  };

  // Calibration anchors: for each offset family, the priced token whose
  // actual market cap sits closest to its model prediction (the median
  // absolute log-ratio) — the family's typical token, not its best or worst.
  const anchors: Radar['anchors'] = [];
  for (const fam of ['curator', 'credit', 'trading', 'yield']) {
    const members = priced.filter((p) => familyOf(p.category) === fam)
      .map((p) => {
        const predicted = Math.exp(fit.a + fit.b * Math.log(p.tvl_usd) + (off[fam] ?? 0));
        return { p, predicted, absLog: Math.abs(Math.log(p.mcap_usd! / predicted)) };
      })
      .sort((a, b) => a.absLog - b.absLog);
    const mid = members[Math.floor(members.length / 2)];
    if (!mid) continue;
    anchors.push({ slug: mid.p.slug, name: mid.p.name, family: fam, predicted: Math.round(mid.predicted), actual: mid.p.mcap_usd!, ratio: round12(mid.p.mcap_usd! / mid.predicted) });
  }

  // Generic-radar card figures, bound from the data at runtime.
  const under50 = priced.filter((p) => p.tvl_usd < 5e7);
  const over250 = priced.filter((p) => p.tvl_usd > 2.5e8);
  const rain = snapshot.protocols.find((p) => p.slug === 'rain');
  const top1 = rows[0]!;
  const generic = {
    peer_top: top1.peer.value,
    peer_top_x: round12(top1.peer.value / top1.implied_value_usd),
    mult_under_50m: round12(median(under50.map((p) => p.mcap_usd! / p.tvl_usd))),
    mult_over_250m: round12(median(over250.map((p) => p.mcap_usd! / p.tvl_usd))),
    rain_tvl: rain?.tvl_usd ?? 0,
    rain_mcap: rain?.mcap_usd ?? 0,
    rain_x: rain ? round12(rain.mcap_usd! / rain.tvl_usd) : 0,
  };

  const familyMembers: Record<string, number> = {};
  for (const p of priced) familyMembers[familyOf(p.category)] = (familyMembers[familyOf(p.category)] ?? 0) + 1;
  const offsetFactors: Record<string, number> = {};
  for (const [fam, o] of Object.entries(off)) offsetFactors[fam] = round12(Math.exp(o));

  const radar: Radar = {
    meta: {
      as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, protocols: snapshot.protocols.length,
      priced: priced.length, pre_token: preToken.length, token_recorded_mcap_null: tokenNoMcap.length,
      board_rows: rows.length, watchlist: snapshot.watchlist.length, early_rows: rows.length - snapshot.watchlist.length,
      model: 'radar-5: LAD log-log curve + shrunk median family offsets (k=5), cap ±0.5, min 3 members',
    },
    curve: { a: round12(fit.a), b: round12(fit.b) },
    ols: { a: round12(ols.a), b: round12(ols.b) },
    offsets: Object.fromEntries(Object.entries(off).map(([k, v]) => [k, round12(v)])),
    offset_factors: offsetFactors,
    family_members: familyMembers,
    gates: { loo: round12(loo), wf: round12(wf.value), loo_ref: 1.500834, wf_ref: 1.616825, loo_log10: round12(loo / Math.LN10) },
    band: [round12(band[0]), round12(band[1])],
    wf_folds: wf.folds,
    rows,
    skip,
    universe: {
      total: snapshot.protocols.length, priced: priced.length,
      token_recorded_mcap_null: tokenNoMcap.length, pre_token: preToken.length,
      rankable: rankableCount, watchlist: snapshot.watchlist.length, early: rows.length - snapshot.watchlist.length,
    },
    signals,
    anchors,
    generic,
    top5: rows.slice(0, 5).map((r) => r.slug),
  };
  return { board: rows, radar };
}

export function dataScript(radar: Radar): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board has ${board.length} rows, fewer than 100`;
  const watch = new Set(snapshot.watchlist);
  const seen = new Set<string>();
  let prev = Infinity;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${r.slug} has rank ${r.rank}, expected ${i + 1}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `row ${r.slug} has a bad implied value`;
    if (r.implied_value_usd > prev) return `implied value rises at rank ${r.rank}`;
    prev = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  for (const s of snapshot.watchlist) if (!seen.has(s)) return `watchlist slug ${s} is missing`;
  return null;
}
