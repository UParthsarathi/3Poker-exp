#!/bin/sh
# Full suite against the live Supabase room table. Summaries land in
# e2e/out-*/summary.txt. LANES=2 runs two browsers at once (needs ~8 GB free).
cd "$(dirname "$0")"
REBUILD=1 OUT=out-smoke node run.mjs smoke 15
lane1() {
  OUT=out-s34 node run.mjs S34 80
  OUT=out-long node run.mjs LONG 110
  OUT=out-s5 node run.mjs S5 60
}
lane2() {
  PORT=5491 OUT=out-s2 node run.mjs S2 85
  PORT=5491 OUT=out-s1 node run.mjs S1 75
  PORT=5491 DIST=dist-nocap NOCAP=1 REBUILD=1 OUT=out-s7 node run.mjs S7 50
  PORT=5491 PAGE=offline.html OUT=out-off node run.mjs SP,MP,MP6 25
}
if [ "${LANES:-1}" = 2 ]; then lane1 & lane2 & wait; else lane1; lane2; fi
for d in out-smoke out-s34 out-long out-s5 out-s2 out-s1 out-s7 out-off; do echo; echo "######## $d"; cat $d/summary.txt 2>/dev/null || echo "(no summary)"; done
