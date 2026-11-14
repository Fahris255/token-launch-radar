# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fahris255/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fahris255/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar (model radar-2) ranks every protocol that records no token in the sealed DefiLlama snapshot by an implied launch value derived from the snapshot itself: each category earns its multiple from the median market-cap/TVL of its own traded comparables, with a family fallback and a global median behind it, adjusted for seven-day growth and tokenless age. Every ranked protocol carries a six-step farm plan with explicit costs and times, and the static dashboard is filterable, sortable, and shows the full multiple table behind the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Then open `out/dashboard/index.html` in a browser. The program writes `out/board.json`,
`out/data.js`, the dashboard, the screenshots, and `out/dossier.json`. Node 22.18 or
later, standard library only, no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=nx7q6dkm&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
