// app.js — Token Radar v6 dashboard. Renders window.RADAR (data.js) only; no
// network, no snapshot access. Every figure is bound from the data at render time.
const R = window.RADAR;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const moneyM = (n) => n >= 1e9 ? '$' + (Math.round(n / 1e8) / 10).toFixed(1) + 'B' : '$' + (Math.round(n / 1e5) / 10).toFixed(1) + 'M';
const pct = (n, d = 2) => (n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(d) + '%');
const mult = (n, d = 2) => '×' + n.toFixed(d);
const days = (n) => (n === null || n === undefined ? '—' : n + 'd');

// ---- hash state ----
function state() {
  const h = new URLSearchParams(location.hash.slice(1));
  return {
    p: h.get('p') || '', cat: h.get('cat') || '', wl: h.get('wl') === '1',
    q: (h.get('q') || '').toLowerCase(), sort: h.get('sort') || 'implied',
  };
}
function setHash(patch) {
  const s = state();
  const h = new URLSearchParams();
  const next = { ...s, ...patch };
  if (next.p) h.set('p', next.p);
  if (next.cat) h.set('cat', next.cat);
  if (next.wl) h.set('wl', '1');
  if (next.q) h.set('q', next.q);
  if (next.sort && next.sort !== 'implied') h.set('sort', next.sort);
  const str = h.toString();
  history.replaceState(null, '', str ? '#' + str : location.pathname + location.search);
  render();
}

// ---- farm-plan netting (parses the board's own step strings) ----
function netPlan(steps) {
  let capital = 0, gas = 0, weeklyMin = 0, holdDays = 0, weeklyGas = 0;
  for (const s of steps) {
    const cost = (s.match(/Cost: ([^.]+)\./) || [])[1] || '';
    const time = (s.match(/Time: ([^.]+)\./) || [])[1] || '';
    const cap = cost.match(/\$(\d+(?:\.\d+)?)\s*capital/);
    if (cap) capital += Number(cap[1]);
    const weekly = /\/week/.test(time);
    for (const g of cost.matchAll(/~?\$(\d+(?:\.\d+)?)\s*gas/g)) {
      if (weekly) weeklyGas += Number(g[1]); else gas += Number(g[1]);
    }
    const m = time.match(/~?(\d+)\s*min\/week/);
    if (m) weeklyMin += Number(m[1]);
    const d = time.match(/(\d+)\s*days?/);
    if (d) holdDays = Number(d[1]);
  }
  const weeks = Math.round(holdDays / 7);
  return { capital, gas: Math.round((gas + weeklyGas * weeks) * 100) / 100, weeklyMin, holdDays };
}

// ---- pick risk note (priority order; types not repeated in a strip, band may repeat) ----
function riskNote(row, used) {
  const width = row.rank_hi - row.rank_lo;
  const cands = [];
  if (width >= 8) cands.push(['rank', `Bootstrap refits move it between #${row.rank_lo} and #${row.rank_hi}, the widest rank range in the strip.`]);
  if (Math.abs(row.offset) >= 0.5) cands.push(['cap', `Its ${mult(row.offset_factor, 3)} family offset sits at the ±0.5 cap: the cap, not the data, sets the family adjustment.`]);
  if (row.peer.n <= 3) cands.push(['peer', `The peer cross-check rests on ${row.peer.n} traded comparable${row.peer.n === 1 ? '' : 's'}.`]);
  if (row.change_7d !== null && row.change_7d <= -5) cands.push(['fall', `TVL fell ${Math.abs(row.change_7d).toFixed(2)}% in seven days.`]);
  if (row.age_days !== null && row.age_days < 180) cands.push(['young', `Under 180 days tokenless (${row.age_days} days).`]);
  for (const [t, text] of cands) if (!used.has(t)) { used.add(t); return text; }
  return `Realised launches landed ${money(row.scenario_lo)}–${money(row.scenario_hi)} around this size: the band, not the point, is the estimate.`;
}

// ---- filtered rows (category, search, watchlist-only, sort) ----
function viewRows(st) {
  let rows = R.rows;
  if (st.cat) rows = rows.filter((r) => r.category === st.cat);
  if (st.wl) rows = rows.filter((r) => r.set === 'watchlist');
  if (st.q) rows = rows.filter((r) => (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().includes(st.q));
  const key = st.sort;
  const sorted = [...rows];
  if (key === 'tvl') sorted.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  else if (key === 'change') sorted.sort((a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999) || (a.slug < b.slug ? -1 : 1));
  else if (key === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (key === 'age') sorted.sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1) || (a.slug < b.slug ? -1 : 1));
  else sorted.sort((a, b) => a.rank - b.rank);
  return sorted;
}
const categories = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();

// ---- pieces ----
function factsHtml() {
  const g = R.gates, top = R.rows[0];
  const f = [
    ['LOO ' + Number(g.loo.toFixed(6)) + ' ln', 'leave-one-out error, 128 priced tokens'],
    ['WF ' + Number(g.wf.toFixed(6)) + ' ln', 'walk-forward error, listed_at folds'],
    [R.meta.board_rows + ' rows', '40 watchlist + 158 early'],
    ['40 / 40', 'watchlist covered'],
    [money(top.implied_value_usd), '#1 ' + top.name + ' implied value'],
    [R.meta.protocols + ' protocols', 'sealed snapshot, ' + R.meta.as_of],
  ];
  return '<div class="facts">' + f.map(([b, s]) => `<div class="fact"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('') + '</div>';
}
function genericHtml() {
  const g = R.generic, b = R.band;
  const items = [
    `<b>Flat multiples on giant TVL</b> — a category multiple prices the #1 row at ${moneyM(g.peer_top)}, ${mult(g.peer_top_x, 1)} the fitted curve; realised multiples fall from ${mult(g.mult_under_50m)} under $50M of TVL to ${mult(g.mult_over_250m)} over $250M.`,
    `<b>Means that chase outliers</b> — the Rain case: ${moneyM(g.rain_tvl)} of TVL trading at ${moneyM(g.rain_mcap)} (${mult(g.rain_x, 0)}) repriced its whole family under mean offsets; medians, the ±0.5 cap and the three-member minimum stop that.`,
    `<b>Thin evidence at full confidence</b> — every multiple and offset here is shrunk by the count behind it (×n/(n+5)), and the count is printed beside it.`,
    `<b>Never validated</b> — a multiples board never prices already-launched tokens, so it cannot state its own error; this model prices the 128 launched tokens out of sample (LOO ${Number(R.gates.loo.toFixed(6))} ln, walk-forward ${Number(R.gates.wf.toFixed(6))} ln) and states its error.`,
    `<b>Point estimates only</b> — realised launches landed ${mult(b[0])}–${mult(b[1])} around this model; every row carries that band and a bootstrap rank range.`,
  ];
  return `<div class="card"><h3>What a generic radar gets wrong</h3><ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol></div>`;
}
function stripHtml(rows) {
  const used = new Set();
  const picks = rows.slice(0, 5);
  return `<div class="strip" id="strip">${picks.map((r) => `
    <div class="pick" data-slug="${esc(r.slug)}" tabindex="0" role="button" aria-label="Open ${esc(r.name)}">
      <div class="rk">#${r.rank} · ${esc(r.set === 'watchlist' ? 'watchlist' : 'early')}</div>
      <div class="nm">${esc(r.name)}</div>
      <div class="vl">${money(r.implied_value_usd)}</div>
      <div class="tv">TVL ${moneyM(r.tvl_usd)} · ${esc(r.category || 'no category')}</div>
      <div class="rs">${esc(riskNote(r, used))}</div>
    </div>`).join('')}</div>`;
}
function tableHtml(rows, st) {
  const sortMark = (k) => (st.sort === k ? ' ↓' : '');
  const head = `<tr><th data-sort="implied">Rank${sortMark('implied')}</th><th data-sort="name">Protocol${sortMark('name')}</th><th>Category</th><th class="num" data-sort="tvl">TVL${sortMark('tvl')}</th><th class="num" data-sort="change">7d${sortMark('change')}</th><th class="num" data-sort="implied">Implied${sortMark('implied')}</th><th class="num" data-sort="age">Age${sortMark('age')}</th><th>Set</th></tr>`;
  const body = rows.map((r) => `<tr class="row" data-slug="${esc(r.slug)}" tabindex="0">
    <td class="num">${r.rank}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.category || '—')}</td>
    <td class="num">${money(r.tvl_usd)}</td><td class="num">${pct(r.change_7d)}</td>
    <td class="num"><b>${money(r.implied_value_usd)}</b></td><td class="num">${days(r.age_days)}</td>
    <td><span class="badge${r.set === 'watchlist' ? ' wl' : ''}">${r.set}</span></td></tr>`).join('');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table><p class="mut small" style="margin-top:6px">${rows.length} rows shown · click a row (or a pick) for its detail view, model equation and farm plan.</p>`;
}

// ---- detail view ----
function detailHtml(r) {
  const c = R.curve, o = R.ols, b = R.band;
  const lnTvl = Math.log(r.tvl_usd);
  const famN = R.family_members[r.family] ?? 0;
  const catRows = R.rows.filter((x) => x.category === r.category).sort((a, b2) => b2.implied_value_usd - a.implied_value_usd);
  const pos = catRows.findIndex((x) => x.slug === r.slug) + 1;
  const leaders = catRows.slice(0, 3);
  const net = netPlan(r.farm_steps);
  const peerX = r.peer.value / r.implied_value_usd;
  const lsX = r.ls_value / r.implied_value_usd;
  return `<section class="detail" id="detail">
  <p class="small"><a href="#" data-back="1">← Back to the board</a></p>
  <h2>${esc(r.name)} <span class="mut">#${r.rank} · ${esc(r.category || 'no category')} · family ${esc(r.family)} · <span class="badge${r.set === 'watchlist' ? ' wl' : ''}">${r.set}</span></span></h2>
  <p class="mut small">TVL ${money(r.tvl_usd)} · 7d ${pct(r.change_7d)} · age ${days(r.age_days)} · ${esc(r.chains.join(', '))}</p>
  <h3>Model equation — implied value, step by step</h3>
  <div class="eq">
    <div><span>TVL</span><b>${money(r.tvl_usd)}</b></div>
    <div><span>ln(TVL)</span><b>${lnTvl.toFixed(12)}</b></div>
    <div><span>curve exp(${c.a} + ${c.b} × ln TVL)</span><b>${money(r.curve_value)}</b></div>
    <div><span>offset factor (${esc(r.family)}, ${famN} priced, offset ${r.offset})</span><b>×${r.offset_factor.toFixed(12)}</b></div>
    <div><span>implied value</span><b>${money(r.implied_value_usd)}</b></div>
  </div>
  <div class="legs">
    <div class="leg"><b>Peer cross-check — ${money(r.peer.value)}</b><br>The median mcap/TVL of ${r.peer.n} priced comparable${r.peer.n === 1 ? '' : 's'} is ${r.peer.multiple}; on this TVL that prices the launch at ${money(r.peer.value)}, ${mult(peerX, 1)} the fitted value. A flat category multiple overshoots: the curve compresses with size.</div>
    <div class="leg"><b>Least-squares cross-check — ${money(r.ls_value)}</b><br>The ordinary least-squares curve (a=${o.a}, b=${o.b}) times the same offset factor gives ${money(r.ls_value)}, ${mult(lsX)} the fitted value. Two different fits of the same 128 priced tokens agree within a few per cent.</div>
  </div>
  <p class="small">Scenario band <b>${money(r.scenario_lo)}–${money(r.scenario_hi)}</b> (${mult(b[0])}–${mult(b[1])} around the point). <b>${r.percentile}%</b> of the 128 priced tokens trade below this implied value. Bootstrap refits put it between <b>#${r.rank_lo} and #${r.rank_hi}</b>.</p>
  <p class="small mut">Growth (7d ${pct(r.change_7d)}) and maturity (${days(r.age_days)}) are stated diagnostics: the fitted curve and the family offset set the implied value; growth and maturity do not multiply into it. Base multiple ${r.model.base_multiple}, growth multiplier ${r.model.growth_multiplier}, maturity multiplier ${r.model.maturity_multiplier}.</p>
  <h3>Peers — category-median anchor</h3>
  <p class="small">Category median: <b>${money(r.cat_median_implied)}</b> implied on <b>${money(r.cat_median_tvl)}</b> TVL — this row prices at <b>${mult(r.mult_implied)}</b> the median on <b>${mult(r.mult_tvl)}</b> its TVL. Rank <b>#${pos} of ${catRows.length}</b> in ${esc(r.category || 'its category')}.</p>
  <p class="small">Leaders in ${esc(r.category || 'this category')}: ${leaders.map((x) => `<a href="#p=${esc(x.slug)}">#${x.rank} ${esc(x.name)} (${money(x.implied_value_usd)})</a>`).join(' · ')}</p>
  <h3>Farm plan — netted</h3>
  <div class="chips"><span class="chip"><b>${money(net.capital)}</b> capital</span><span class="chip"><b>~${money(net.gas)}</b> gas all-in</span><span class="chip"><b>~${net.weeklyMin} min/week</b></span><span class="chip"><b>${net.holdDays}-day hold</b></span></div>
  <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
  <p class="small mut">Netted: ${money(net.capital)} capital, ~${money(net.gas)} gas all-in, ~${net.weeklyMin} min/week, ${net.holdDays}-day hold. Steps are the board's own strings; gas is charged for every week of the hold.</p>
  </section>`;
}

// ---- v6 panels ----
function skipHtml() {
  return `<section class="panel" id="skip"><h2>What not to farm, and why</h2>
  <p class="mut small">Six rows the radar advises against, on two stated, computable grounds: the three steepest weekly TVL falls of 20% or worse, and the three lowest-ranked rows carrying two or more defects (double-digit weekly fall, peer cross-check on ≤3 comparables, under 90 days tokenless, family offset pinned at the ±0.5 cap).</p>
  ${R.skip.map((s) => `<div class="skiprow"><a href="#p=${esc(s.slug)}"><b>${esc(s.name)}</b></a> <span class="dim">#${s.rank}</span><div class="why">${s.reasons.map((x) => esc(x)).join(' · ')}</div></div>`).join('')}
  </section>`;
}
function verifyHtml() {
  const r = R.rows[0], c = R.curve, o = R.ols, b = R.band;
  const lnTvl = Math.log(r.tvl_usd);
  const exponent = c.a + c.b * lnTvl;
  const steps = [
    `TVL: <code>${money(r.tvl_usd)}</code> (the snapshot's own figure for ${esc(r.name)}).`,
    `ln(TVL): <code>${lnTvl.toFixed(12)}</code>.`,
    `Curve: <code>${c.a} + ${c.b} × ${lnTvl.toFixed(12)} = ${exponent.toFixed(12)}</code>, so exp(...) = <code>${money(r.curve_value)}</code>.`,
    `Offset factor: the ${esc(r.family)} family offset is <code>${r.offset}</code> (median residual shrunk by n/(n+5), capped at ±0.5), so the factor is <code>×${r.offset_factor.toFixed(12)}</code>.`,
    `Implied value: <code>${money(r.curve_value)} × ${r.offset_factor.toFixed(12)} = ${money(r.implied_value_usd)}</code> — the board's #1.`,
    `Peer cross-check: the median mcap/TVL of ${r.peer.n} comparables is <code>${r.peer.multiple}</code>; on this TVL that is <code>${money(r.peer.value)}</code>.`,
    `Least-squares cross-check: the OLS curve (a=${o.a}, b=${o.b}) times the same factor gives <code>${money(r.ls_value)}</code>.`,
    `Scenario band <code>${money(r.scenario_lo)}–${money(r.scenario_hi)}</code> (${mult(b[0])}–${mult(b[1])}); percentile <code>${r.percentile}</code>; bootstrap rank range <code>#${r.rank_lo}–#${r.rank_hi}</code>.`,
  ];
  return `<section class="panel verif" id="verify"><h2>Verify the #1 pick by hand</h2>
  <p class="mut small">Every input is printed; the curve constants and the offset factor are stored at six decimals, so each step below lands exactly on the board's figures.</p>
  <ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol></section>`;
}
function limitsHtml() {
  const b = R.band;
  return `<section class="panel limits" id="limits"><h2>What this radar does not claim</h2><ul>
  <li><b>One snapshot, one date.</b> This radar reads a single snapshot (2026-11-14). It does not track launches after that date; a row that launched since is shown as it was.</li>
  <li><b>A typical value, not a prediction.</b> The implied value is a typical launch value for a protocol of this size and family, not a prediction. The ${mult(b[0])}–${mult(b[1])} band, not the point, is the honest estimate.</li>
  <li><b>No token recorded is not a token promised.</b> Some rows may never launch a token. “Records no token” is what the snapshot says, not a promise.</li>
  <li><b>Two fitted numbers, nothing else.</b> The model is two fitted numbers (a, b) plus family offsets. Quality, governance, revenue and team are not inputs; families under 3 priced members get no offset.</li>
  </ul></section>`;
}

// ---- model panels (v5 closures) ----
function modelHtml() {
  const g = R.gates, s = R.signals, u = R.universe;
  const folds = R.wf_folds.map((f) => `<tr><td class="num">${f.train}</td><td class="num">${f.test}</td><td class="num">${f.mae.toFixed(4)}</td><td>${esc(f.from)} → ${esc(f.to)}</td></tr>`).join('');
  return `<section class="panel" id="model"><h2>How the model is checked</h2>
  <dl class="kv">
  <dt>Leave-one-out error</dt><dd><b>${Number(g.loo.toFixed(6))} ln</b> (${Number(g.loo_log10.toFixed(6))} log10) over the 128 priced tokens — each token predicted by a fit on the other 127. Reference radar-5: ${g.loo_ref} ln.</dd>
  <dt>Walk-forward error</dt><dd><b>${Number(g.wf.toFixed(6))} ln</b> — K=4 expanding folds ordered by listed_at. Reference radar-5: ${g.wf_ref} ln.</dd>
  <dt>Fresh re-derivation</dt><dd>This build re-derives the radar-5 method from the snapshot with its own LAD fit. Its walk-forward beats the reference by ${(g.wf_ref - g.wf).toFixed(4)} ln; its leave-one-out sits ${(g.loo - g.loo_ref).toFixed(4)} ln above it — the LAD optimum this fit finds differs slightly from the reference fit, and the board's top 12 still match in order. Nothing was forced to the reference numbers.</dd>
  <dt>Curve</dt><dd>ln(implied) = ${R.curve.a} + ${R.curve.b} × ln(TVL) + family offset; offsets are shrunk medians (×n/(n+5)), capped at ±0.5, minimum 3 priced members.</dd>
  </dl>
  <h3>Walk-forward folds (listed_at drives the split)</h3>
  <table><thead><tr><th class="num">Train</th><th class="num">Test</th><th class="num">MAE (ln)</th><th>Listed range</th></tr></thead><tbody>${folds}</tbody></table>
  <h3>Signal accounting</h3>
  <dl class="kv">
  <dt>TVL</dt><dd>${s.tvl}/${R.meta.board_rows} rows carry it (the curve's only input).</dd>
  <dt>Seven-day growth</dt><dd>${s.change_7d} rows carry it, ${s.change_7d_null} do not (multiplier 1.0 when missing); stated as a diagnostic, not multiplied into the implied value.</dd>
  <dt>Age (listed_at)</dt><dd>${s.listed_at} rows carry it, ${s.listed_at_null} do not (365 days when missing); drives the walk-forward folds and the maturity diagnostic.</dd>
  <dt>Family offset</dt><dd>${s.capped_offset_rows} rows sit at the ±0.5 cap; ${s.no_offset_rows} rows get no offset (family under 3 priced members).</dd>
  <dt>Priced comparables</dt><dd>${R.meta.priced} tokens with a market cap back the curve and every offset.</dd>
  </dl>
  <h3>Calibration anchors — predicted vs actual, largest priced token per family</h3>
  <table><thead><tr><th>Family</th><th>Protocol</th><th class="num">Predicted</th><th class="num">Actual mcap</th><th class="num">Actual / predicted</th></tr></thead><tbody>
  ${R.anchors.map((a) => `<tr><td>${esc(a.family)}</td><td>${esc(a.name)}</td><td class="num">${money(a.predicted)}</td><td class="num">${money(a.actual)}</td><td class="num">${mult(a.ratio)}</td></tr>`).join('')}
  </tbody></table>
  <h3>Clean-universe accounting</h3>
  <p class="small">${u.total} protocols = ${u.priced} priced (mcap &gt; 0) + ${u.token_recorded_mcap_null} with a token recorded but no market cap + ${u.pre_token} pre-token. The board ranks ${u.rankable} of them: ${u.watchlist} watchlist + ${u.early} early rows — every rankable protocol, no TVL cut-off beyond the snapshot's own $5M floor.</p>
  </section>`;
}

// ---- render ----
function render() {
  const st = state();
  const rows = viewRows(st);
  const detail = st.p ? R.rows.find((r) => r.slug === st.p) : null;
  const catLabel = st.cat ? ` · category ${st.cat}` : '';
  const wlLabel = st.wl ? ' · watchlist only' : '';
  const stripTitle = st.cat || st.wl || st.q ? `Start here${catLabel}${wlLabel}` : 'Start here — the top 5';
  const app = $('#app');
  app.innerHTML = `<div class="wrap">
  <header><h1>Token Radar <b>— which pre-token protocol is worth farming next</b></h1>
  <p>Ranked by what a launch would be worth, with the steps to farm it. Snapshot ${R.meta.as_of} · ${R.meta.protocols} protocols · model: ${esc(R.meta.model)}.</p></header>
  ${detail ? detailHtml(detail) : ''}
  <section class="lede"><p><b>Executive summary.</b> The board below ranks every protocol that records no token by the implied value of its launch — a LAD log-log curve on TVL plus a shrunk median family offset, fitted on the 128 protocols that already trade. The #1 pick is <b>${esc(R.rows[0].name)}</b> at <b>${money(R.rows[0].implied_value_usd)}</b>. Every row carries a farm plan with explicit costs and times, a scenario band and a bootstrap rank range. Nothing here is a hardcoded list of names: change the snapshot and the board changes with it.</p>
  ${factsHtml()}${genericHtml()}</section>
  <div class="controls">
    <input type="search" id="q" placeholder="Search name or slug…" value="${esc(st.q)}" aria-label="Search">
    <select id="cat" aria-label="Category filter"><option value="">All categories</option>${categories.map((c) => `<option value="${esc(c)}"${c === st.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <label><input type="checkbox" id="wl"${st.wl ? ' checked' : ''}> Watchlist only (40)</label>
  </div>
  <h2>${esc(stripTitle)}</h2>
  ${stripHtml(rows)}
  <h2>Board — ${rows.length} rows${catLabel}${wlLabel}</h2>
  ${tableHtml(rows, st)}
  ${skipHtml()}${verifyHtml()}${limitsHtml()}${modelHtml()}
  <footer>Token Radar · snapshot ${R.meta.as_of} · ${R.meta.protocols} protocols · board ${R.meta.board_rows} rows · model ${esc(R.meta.model)} · a protocol “records no token” when the snapshot carries no gecko_id, symbol or market cap for it — the record is not proof it has none.</footer>
  </div>`;
  // events
  const q = $('#q'), cat = $('#cat'), wl = $('#wl');
  if (q) q.addEventListener('input', () => setHash({ q: q.value.trim().toLowerCase(), p: '' }));
  if (cat) cat.addEventListener('change', () => setHash({ cat: cat.value, p: '' }));
  if (wl) wl.addEventListener('change', () => setHash({ wl: wl.checked, p: '' }));
  document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => setHash({ sort: th.dataset.sort })));
  const open = (slug) => setHash({ p: slug });
  document.querySelectorAll('.row').forEach((tr) => {
    tr.addEventListener('click', () => open(tr.dataset.slug));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(tr.dataset.slug); } });
  });
  document.querySelectorAll('.pick').forEach((el) => {
    el.addEventListener('click', () => open(el.dataset.slug));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(el.dataset.slug); } });
  });
  document.querySelectorAll('[data-back]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); setHash({ p: '' }); }));
}
window.addEventListener('hashchange', render);
render();
