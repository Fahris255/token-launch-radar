// Launch Radar dashboard (radar-2). Reads window.RADAR, written beside dashboard/ by main.ts,
// and renders the ranked board, a filterable and sortable table, a per-protocol detail view with
// the model's own inputs, the derived category-multiple table, and each protocol's farm plan.
// No network: every byte it shows is in data.js, and the page recomputes each row from the same
// formula lib/model.ts uses, so the page and board.json visibly agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(3); }

  // The radar-2 model in one function: a row's own category multiple (derived by main.ts from
  // the snapshot's token comparables) times the growth and maturity multipliers. The detail
  // view compares this recomputation with the number board.json carries.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity));
  }
  function multipleEntry(category) {
    var key = category || 'Other';
    for (var i = 0; i < DATA.multiples.length; i++) if (DATA.multiples[i].category === key) return DATA.multiples[i];
    return null;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json (lib/model.ts farmSteps):
  // category decides the core and weekly actions, TVL the capital, age the hold, a sharp
  // seven-day fall the cautious sizing in step 2, and a young age the checks in step 5.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionsFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateral') >= 0)
      return { core: 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow no more than 30% against the collateral and keep both sides open', weekly: 'Run one small borrow-and-repay cycle on ' + name + ' so the account shows two-sided use, not a parked deposit' };
    if (c.indexOf('dex') >= 0)
      return { core: 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ', choosing a stable or blue-chip pair, and keep the position open', weekly: "Make one swap through " + name + "'s own router on " + chain + ', however small, so the week shows a real trade' };
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('option') >= 0 || c.indexOf('synthetic') >= 0)
      return { core: 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position rather than a directional bet', weekly: 'Place one small trade or adjust the hedge on ' + name + ' so the account stays active for the week' };
    if (c.indexOf('cdp') >= 0 || c.indexOf('stable') >= 0)
      return { core: 'Mint the stable asset of ' + name + ' against $' + capital + ' of collateral on ' + chain + ", keeping the collateral ratio comfortably above its minimum", weekly: 'Add or remove a small amount of collateral on ' + name + ' so the position is touched, not forgotten' };
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0)
      return { core: 'Deposit $' + capital + ' into a curated vault of ' + name + ' on ' + chain + ' and keep the vault shares in the farming wallet', weekly: 'Check the vault allocation page of ' + name + ', then make one small deposit or withdrawal so the week is recorded' };
    if (c.indexOf('rwa') >= 0)
      return { core: 'Mint $' + capital + ' of the yield-bearing asset of ' + name + ' on ' + chain + ' and hold it in the farming wallet', weekly: 'Open the holder and rewards page of ' + name + ' and make one small extra mint if the page offers one' };
    if (c.indexOf('basis') >= 0)
      return { core: 'Deposit $' + capital + ' into the basis-trading vault of ' + name + ' on ' + chain + ' and keep the position through a full funding cycle', weekly: 'Make one scheduled weekly deposit into ' + name + ', even a small one, so the streak of activity continues' };
    if (c === 'chain')
      return { core: 'Use ' + name + ' as a chain: bridge or transfer $' + capital + ' onto it and make one transaction in a native app', weekly: 'Make several small native transactions on ' + name + ' across the week, not all in one minute' };
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0)
      return { core: 'Route a real payment or transfer of about $' + capital + ' through ' + name + ' instead of a test click', weekly: 'Make one small real payment through ' + name + ' so the week shows genuine use' };
    if (c.indexOf('insurance') >= 0)
      return { core: 'Buy about $' + capital + ' of cover from ' + name + ' on ' + chain + ' for a position you already hold elsewhere', weekly: 'Check the active policy on ' + name + ' and extend it if it is close to expiring' };
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('anchor') >= 0 || c.indexOf('btc') >= 0)
      return { core: 'Stake $' + capital + ' of the staking asset through ' + name + ' on ' + chain + ' and keep the receipt token in the farming wallet', weekly: 'Make one small stake or unstake on ' + name + ' so the position changes during the week' };
    if (c.indexOf('governance') >= 0 || c.indexOf('incentive') >= 0)
      return { core: 'Deposit $' + capital + ' into an incentivised market of ' + name + ' on ' + chain + ' and vote if a vote is open', weekly: 'Claim any incentive shown on ' + name + ' and cast one vote if a proposal is live' };
    if (c.indexOf('prediction') >= 0)
      return { core: 'Fund ' + name + ' with $' + capital + ' and take one position in a market you have actually read', weekly: 'Take one new small position on ' + name + ' in a different market from last week' };
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('liquidity') >= 0)
      return { core: 'Deposit $' + capital + ' into the main vault of ' + name + ' on ' + chain + ' and keep the shares in the farming wallet', weekly: 'Claim the vault reward on ' + name + ' and compound it back into the same vault' };
    if (c.indexOf('launchpad') >= 0)
      return { core: 'Register the farming wallet on ' + name + ' and deposit $' + capital + ' toward a live or upcoming pool on ' + chain, weekly: 'Check the launch calendar of ' + name + ' once and join one waitlist or pool step it offers' };
    return { core: 'Deposit $' + capital + ' of USDC into the main product of ' + name + ' on ' + chain + ' and keep the position open', weekly: 'Make one qualifying action on ' + name + ', such as a deposit, a swap or a vote, so the week is recorded' };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var acts = actionsFor(p, capital, chain);
    var falling = p.change_7d !== null && p.change_7d !== undefined && p.change_7d <= -10;
    var coreText = falling
      ? acts.core + '. TVL fell ' + Math.abs(p.change_7d).toFixed(1) + '% in seven days: start with half the capital and add the rest only after a stable week'
      : acts.core;
    var young = p.age_days !== null && p.age_days !== undefined && p.age_days < 180;
    return [
      { text: 'Set up a fresh farming wallet that holds only the funds this plan uses, keep its seed phrase offline, and verify every link from the official page of ' + p.name + ' itself', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: coreText, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: acts.weekly, cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot or epoch', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: young
          ? 'Because ' + p.name + ' has run for under 180 days, check its official points, rewards and token announcements twice a week, and claim only from a link the protocol itself publishes'
          : "Before you withdraw, open the points or rewards page of " + p.name + ' and claim only from the link it publishes', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so the position can be repeated, audited or unwound', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Launch Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, DATA.watchlist_size + ' watchlist protocols, ranked by ', el('em', { text: 'what their category is worth' })),
        el('p', { text: 'Every protocol here records no token in the snapshot. Each is valued with the multiple its own category earns from protocols that already trade, adjusted for seven-day growth and for how long it has run tokenless. The watchlist is the floor: the early radar adds ' + DATA.early_size + ' more below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows added' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Global multiple' }), el('b', { text: fmtMult(DATA.global_multiple) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Records no token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    if (!max) max = 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var entry = multipleEntry(r.category);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', null, el('div', { class: 'mult' }, fmtMult(r.category_multiple), el('small', { text: r.multiple_source + (entry && entry.family ? ' / ' + entry.family : '') }))),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status' + (r.watchlist ? ' watch' : ''), text: r.watchlist ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Protocols that record no token, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('multiple', 'Category x'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Set' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Live token: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the ranking, and they are the comparables the category multiples are derived from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var onBoard = {};
    DATA.rows.forEach(function (r) { onBoard[r.category || 'Other'] = true; });
    var tbody = el('tbody');
    DATA.multiples.filter(function (e) { return onBoard[e.category]; }).forEach(function (e) {
      tbody.appendChild(el('tr', null,
        el('td', { text: e.category }),
        el('td', { class: 'num', text: String(e.comparables) }),
        el('td', { class: 'num', text: fmtMult(e.multiple) }),
        el('td', null, el('span', { class: 'src ' + e.source, text: e.source === 'category' ? 'own comparables' : e.source === 'family' ? 'family: ' + (e.family || '') : 'global median' }))
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures only. No protocol name is special-cased. Each category multiple is the median market-cap / TVL of the protocols in this snapshot that already record a token in that category, winsorised to [' + m.winsor_low + ', ' + m.winsor_high + ']. A category with fewer than ' + m.min_comparables + ' comparables uses its family median, then the global median (' + fmtMult(DATA.global_multiple) + ').' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'mtable' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category on the board' }), el('th', { scope: 'col', text: 'Comparables' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Source' }))),
          tbody
        )
      ),
      el('p', { class: 'sub', text: 'Age is the time since the protocol was first listed, the best record of how long it has run with no token recorded; an unknown age uses ' + m.unknown_age_days + ' days. Early rows pass the same style of screen as the watchlist: no exchange, bridge or staking-product categories, no versioned names, no wrapped or staked products of a protocol that already trades.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var entry = multipleEntry(row.category);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' / watchlist' : ' / early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Multiple source' }), el('b', { text: row.multiple_source + (entry && entry.family ? ' / ' + entry.family : '') })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age, no token recorded' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Growth x' + row.growth_multiplier + ', maturity x' + row.maturity_multiplier + '. Model ' + DATA.model_version + ' recomputes this row on this page as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate from the snapshot, not a price and not a prediction that a token will be issued.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('footer', { text: 'Source: the sealed DefiLlama snapshot of ' + DATA.as_of + '. Protocols here record no token in that snapshot; that is a statement about the record, not a guarantee. Implied values are this entry\u2019s model.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
