// Runs inside each phone (iframe) BEFORE the app. Plays this phone's turns
// through the app's own handlers (read from React fibers), fakes network
// trouble on command, and reports a snapshot of what this phone sees to the
// referee page (window.parent) via postMessage.
(() => {
  const Q = new URLSearchParams(location.search);
  const PHONE = +Q.get('phone');
  const CFG = { tmin: +Q.get('tmin') || 20, tmax: +Q.get('tmax') || 60, gmin: +Q.get('gmin') || 150, gmax: +Q.get('gmax') || 450, pause: +Q.get('pause') || 1500 };
  if (Q.get('name') && !localStorage.getItem('TRI_STACK_PLAYER_NAME')) localStorage.setItem('TRI_STACK_PLAYER_NAME', Q.get('name'));

  const OFFLINE = Q.get('offline');
  if (OFFLINE) { const rt = window.setTimeout; window.setTimeout = (fn, ms, ...a) => rt(fn, ms === 1500 ? 40 : ms, ...a); }
  const st = { scoreErr: [], pg: 0, pgAt: Date.now(), reqMax: 0, slow5: 0, fe: 0, rs: 0, alerts: [], errs: {}, ne: 0, w: 0, rf: 0, rd: 0, dr: 0, dbl: 0, nr: 0 };
  const err = m => { m = String(m).slice(0, 150); st.errs[m] = (st.errs[m] || 0) + 1; st.ne++; };
  window.alert = m => { st.alerts.push(String(m).slice(0, 100)); if (st.alerts.length > 20) st.alerts.shift(); };
  window.confirm = () => true;
  // Headless iframes can report "hidden"; a phone being played is visible.
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  Object.defineProperty(document, 'hidden', { get: () => false });
  const oe = console.error;
  console.error = (...a) => { err('E ' + a.map(x => (x && x.message) || String(x)).join(' ')); oe.apply(console, a); };
  addEventListener('error', e => err('onerror ' + e.message));
  addEventListener('unhandledrejection', e => err('rejection ' + ((e.reason && e.reason.message) || e.reason)));

  // ---- network shims (installed before supabase-js captures fetch/WebSocket)
  const net = { deaf: false, asleep: false, slow: Q.get('slow') ? Q.get('slow').split('-').map(Number) : null };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (net.asleep) throw new TypeError('Failed to fetch');
    if (net.slow) await new Promise(r => setTimeout(r, net.slow[0] + Math.random() * (net.slow[1] - net.slow[0])));
    const t0 = Date.now();
    let res;
    try { res = await realFetch(input, init); } catch (e) { if (url.includes('/rest/v1/')) st.fe++; throw e; }
    finally { const d = Date.now() - t0; if (url.includes('/rest/v1/')) { st.reqMax = Math.max(st.reqMax, d); if (d > 5000) st.slow5++; } }
    if (url.includes('/rest/v1/rooms')) {
      if (method === 'PATCH') { st.w++; res.clone().text().then(t => { if (t.trim() === '[]') st.rf++; }).catch(() => {}); }
      else if (method === 'GET') st.rd++;
    }
    return res;
  };
  const RealWS = window.WebSocket;
  const onmsg = Object.getOwnPropertyDescriptor(RealWS.prototype, 'onmessage');
  const sockets = new Set();
  function WS(url, protocols) {
    const ws = new RealWS(net.asleep ? 'ws://127.0.0.1:9/' : url, protocols);
    sockets.add(ws);
    ws.addEventListener('close', () => sockets.delete(ws));
    Object.defineProperty(ws, 'onmessage', {
      configurable: true,
      get() { return onmsg.get.call(ws); },
      set(fn) { onmsg.set.call(ws, fn ? (e => { if (net.deaf || net.asleep) { st.dr++; return; } if (typeof e.data === 'string' && e.data.includes('postgres_changes')) { st.pg++; st.pgAt = Date.now(); } fn.call(ws, e); }) : fn); }
    });
    return ws;
  }
  WS.prototype = RealWS.prototype;
  Object.assign(WS, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = WS;

  // ---- fibers
  const nm = f => (f && f.type && typeof f.type === 'function') ? (f.type.name || '').replace(/\$\d+$/, '') : '';
  const NAMES = ['App', 'Auth', 'MainMenu', 'OnlineSelect', 'Lobby', 'GameTable', 'LoadingScreen', 'RoundSelect', 'NameEntry', 'Transition'];
  const scan = () => {
    const el = document.getElementById('root'); const F = {};
    const k = el && Object.keys(el).find(k => k.startsWith('__reactContainer'));
    if (!k) return F;
    const stack = [el[k].stateNode.current];
    while (stack.length) {
      const f = stack.pop(); if (!f) continue;
      const n = nm(f); if (NAMES.includes(n) && !F[n]) F[n] = f;
      if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child);
    }
    return F;
  };
  const appState = F => {
    let h = F.App && F.App.memoizedState;
    while (h) { const s = h.memoizedState; if (s && typeof s === 'object' && 'deck' in s && 'players' in s && 'phase' in s) return s; h = h.next; }
    return null;
  };
  const hnum = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const sig = g => [g.phase, g.currentPlayerIndex, g.roundNumber, g.deck.map(c => c.id).join(','), g.openDeck.map(c => c.id).join(','),
    g.players.map(p => p.id + ':' + p.hand.map(c => c.id).join(',') + ':' + p.totalScore).join('|'),
    (g.pendingToss || []).map(c => c.id).join(','), g.pendingDiscard ? g.pendingDiscard.id : ''].join('#');
  // Turns from versions (2 per turn), so it works whether or not the log is capped.
  const rv = {};
  const turnsIn = g => { const k = g.gameId + ':' + g.roundNumber; rv[k] = Math.min(rv[k] ?? g.version, g.version); return Math.floor((g.version - rv[k]) / 2); };
  const target = g => CFG.tmin + (hnum(g.gameId + ':' + g.roundNumber) % (CFG.tmax - CFG.tmin + 1));

  // ---- commands from the referee
  const cmds = [];
  let task = null, paused = false, dbl = false, nextAt = 0, plan = null;
  const reAt = {};
  addEventListener('message', e => { if (e.data && e.data.__cmd) { if (e.data.__cmd === 'leave') task = null; cmds.push(e.data); } });
  const wake = () => { net.asleep = false; document.dispatchEvent(new Event('visibilitychange')); };
  const instant = m => {
    switch (m.__cmd) {
      case 'sleep': net.asleep = true; sockets.forEach(ws => { try { ws.close(4000, 'sleep'); } catch (e) {} }); setTimeout(wake, m.ms); return true;
      case 'deaf': net.deaf = true; setTimeout(() => { net.deaf = false; }, m.ms); return true;
      case 'slow': net.slow = m.range || null; return true;
      case 'pause': paused = true; return true;
      case 'resume': paused = false; return true;
      case 'double': dbl = true; return true;
      case 'refresh': location.reload(); return true;
      case 'nudge': document.dispatchEvent(new Event('visibilitychange')); return true;
    }
    return false;
  };
  const runTask = F => {
    const t = task;
    const os = F.OnlineSelect && F.OnlineSelect.memoizedProps, mm = F.MainMenu && F.MainMenu.memoizedProps;
    const lb = F.Lobby && F.Lobby.memoizedProps, gt = F.GameTable && F.GameTable.memoizedProps;
    switch (t.__cmd) {
      case 'create':
        if (lb) task = null; else if (os && !t.sent) { os.onCreate(); t.sent = 1; } else if (mm) mm.setShowOnlineSelection(true);
        break;
      case 'join':
        if (lb) { task = null; break; }
        if (os) {
          if (os.joinCodeInput !== t.code) os.setJoinCodeInput(t.code);
          else if (!os.isJoining && (!t.sent || Date.now() - t.sent > 6000)) { os.onJoin(); t.sent = Date.now(); t.tries = (t.tries || 0) + 1; }
        } else if (mm) mm.setShowOnlineSelection(true);
        break;
      case 'start':
        if (!lb) { if (gt) task = null; break; }
        if (lb.rounds.selectedTotalRounds !== t.rounds) lb.rounds.setRoundsAndSync(t.rounds);
        else if (!t.sent || Date.now() - t.sent > 5000) { lb.onStart(); t.sent = Date.now(); }
        break;
      case 'sp': {
        const rs = F.RoundSelect && F.RoundSelect.memoizedProps;
        if (gt) task = null; else if (rs) rs.onStart(t.rounds); else if (mm) mm.onSinglePlayer();
        break; }
      case 'mp': {
        const ne = F.NameEntry && F.NameEntry.memoizedProps;
        if (gt || F.Transition) task = null;
        else if (ne) { if (ne.rounds.selectedTotalRounds !== t.rounds) ne.rounds.setRoundsAndSync(t.rounds); else ne.onStart(); }
        else if (mm) mm.onPlayerCount(t.count);
        break; }
      case 'leave': if (gt) gt.clearSession(); else if (lb) lb.onLeave(); task = null; break;
      case 'kick': if (gt) gt.handleKickPlayer(t.id); task = null; break;
      case 'returnLobby': if (gt) gt.handleReturnToLobby(); task = null; break;
      default: task = null;
    }
  };

  const act = (fn, quick) => {
    fn();
    if (dbl && !quick) { dbl = false; st.dbl++; fn(); }
    nextAt = Date.now() + (quick ? 60 + Math.random() * 90 : CFG.gmin + Math.random() * (CFG.gmax - CFG.gmin));
  };
  const play = gt => {
    const g = gt.gameState;
    if (paused || net.asleep || Date.now() < nextAt) return;
    if (g.phase === 'ROUND_END') {
      if ((g.gameMode === 'SINGLE_PLAYER' || g.gameMode === 'MULTIPLAYER' || (g.gameMode === 'ONLINE_HOST' && gt.myOnlineId === gt.onlineHostId)) && g.roundNumber < g.totalRounds) {
        const key = g.gameId + ':' + g.roundNumber;
        if (!reAt[key]) reAt[key] = Date.now() + CFG.pause;          // read the scores for a moment
        else if (Date.now() >= reAt[key]) { gt.nextRound(); if (dbl) { dbl = false; st.dbl++; gt.nextRound(); } st.nr++; reAt[key] = Date.now() + 5000; }
      }
      return;
    }
    if (!gt.isPlayerTurn) return;
    const me = OFFLINE ? (gt.currentPlayer.id === gt.bottomPlayer.id ? gt.bottomPlayer : null) : g.players.find(p => p.id === gt.myOnlineId);
    if (!me) return;
    if (g.phase === 'PLAYER_TURN_START') {
      if (turnsIn(g) >= target(g)) return act(() => gt.handleShow());
      const key = g.gameId + ':' + g.version;
      if (!plan || plan.key !== key) {
        const byRank = {}; me.hand.forEach(c => (byRank[c.rank] = byRank[c.rank] || []).push(c.id));
        const pair = Object.values(byRank).find(a => a.length >= 2);
        const want = (!g.tossedThisTurn && pair && Math.random() < 0.8) ? pair.slice(0, 2)
          : [[...me.hand].sort((a, b) => b.value - a.value)[0]].filter(Boolean).map(c => c.id);
        plan = { key, want };
      }
      const want = plan.want, sel = gt.selectedCardIds;
      if (!want.length) return;
      const extra = sel.find(id => !want.includes(id));
      if (extra) return act(() => gt.handleCardClick(me.hand.find(c => c.id === extra) || { id: extra }), true);
      const missing = want.find(id => !sel.includes(id));
      if (missing) return act(() => gt.handleCardClick(me.hand.find(c => c.id === missing)), true);
      return act(() => (want.length === 2 ? gt.handleToss() : gt.handleDiscard()));
    }
    if (g.phase === 'PLAYER_DRAW' || g.phase === 'PLAYER_TOSSING_DRAW') {
      const top = g.openDeck[g.openDeck.length - 1];
      const open = top && !(g.phase === 'PLAYER_DRAW' && top.id === g.lastDiscardedId) && Math.random() < 0.3;
      if (!open && g.deck.length === 0) st.rs++;   // this draw reshuffles the open pile into the deck
      return act(() => gt.handleDraw(open ? 'OPEN' : 'DECK'));
    }
  };

  // ---- main loop
  let last = '', lastPost = 0, tk = 0, tkAt = Date.now(), tps = 0;
  setInterval(() => {
    tk++; if (Date.now() - tkAt >= 10000) { tps = Math.round(tk * 100000 / (Date.now() - tkAt)) / 10; tk = 0; tkAt = Date.now(); }
    let F;
    try {
      F = scan();
      while (cmds.length && !task) { const m = cmds.shift(); if (!instant(m)) task = m; }
      if (F.Auth) F.Auth.memoizedProps.onGuestPlay();
      if (task) { task.at = task.at || Date.now(); if (Date.now() - task.at > 20000) { err('TASK_TIMEOUT ' + task.__cmd); task = null; } else runTask(F); }
      const gt = F.GameTable && F.GameTable.memoizedProps;
      if (F.Transition && Date.now() >= nextAt) { F.Transition.memoizedProps.onReady(); nextAt = Date.now() + 60; }
      if (gt) play(gt);
    } catch (e) { err('DRIVER ' + e.message); }
    try {
      F = scan();
      const gt = F.GameTable && F.GameTable.memoizedProps, lb = F.Lobby && F.Lobby.memoizedProps;
      const g = gt ? gt.gameState : appState(F);
      const screen = gt ? 'GameTable' : lb ? 'Lobby' : F.OnlineSelect ? 'OnlineSelect' : F.MainMenu ? 'MainMenu' : F.Auth ? 'Auth' : F.LoadingScreen ? 'Loading' : '?';
      const s = { phone: PHONE, screen, net: net.asleep ? 'asleep' : net.deaf ? 'deaf' : 'ok', paused };
      if (gt || lb) Object.assign(s, { me: (gt || lb).myOnlineId, host: (gt || lb).onlineHostId, code: (gt || lb).roomCode });
      if (lb) s.roster = lb.onlineLobbyPlayers.map(p => p.id).join(',');
      if (g && g.players && g.players.length && gt) {
        const ids = [...g.deck, ...g.openDeck, ...g.players.flatMap(p => p.hand), ...(g.pendingToss || []), ...(g.pendingDiscard ? [g.pendingDiscard] : [])].map(c => c.id);
        Object.assign(s, {
          mode: g.gameMode, gid: g.gameId, v: g.version, round: g.roundNumber, total: g.totalRounds, phase: g.phase,
          cur: (g.players[g.currentPlayerIndex] || {}).id, ids: g.players.map(p => p.id).join(','),
          inGame: g.players.some(p => p.id === gt.myOnlineId), bottom: gt.bottomPlayer && gt.bottomPlayer.id, myTurn: gt.isPlayerTurn,
          cards: ids.length, uniq: new Set(ids).size, h: hnum(sig(g)).toString(36),
          totals: g.players.map(p => p.id + ':' + p.totalScore).join(','),
          off: (gt.onlineIds || []).length ? g.players.filter(p => p.id !== gt.myOnlineId && !gt.onlineIds.includes(p.id)).map(p => p.id).join(',') : ''
        });
      }
      if (OFFLINE && g && g.players && g.players.length && gt) {
        const rk = g.gameId + ':' + g.roundNumber;
        st.start = st.start || {};
        if (g.phase !== 'ROUND_END' && !st.start[rk]) st.start[rk] = Object.fromEntries(g.players.map(p => [p.id, p.totalScore]));
        if (g.phase === 'ROUND_END' && st.start[rk] && !st.start[rk].done) {
          st.start[rk].done = 1;
          g.players.forEach(p => { if (p.totalScore !== st.start[rk][p.id] + p.score) st.scoreErr.push(`r${g.roundNumber} p${p.id}`); });
          st.rounds = (st.rounds || 0) + 1;
        }
        Object.assign(s, { scoreErr: st.scoreErr.join(' '), roundsScored: st.rounds || 0, screen2: F.Transition ? 'Transition' : '' });
      }
      const key = JSON.stringify(s);
      if (key !== last || Date.now() - lastPost > 1000) {
        last = key; lastPost = Date.now();
        parent.postMessage({ __tri: 1, snap: { ...s, pg: st.pg, pgAge: Date.now() - st.pgAt, reqMax: st.reqMax, slow5: st.slow5, fe: st.fe, ws: sockets.size, tps, rs: st.rs, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : 0, w: st.w, rf: st.rf, rd: st.rd, dr: st.dr, dbl: st.dbl, nr: st.nr, ne: st.ne, errs: st.errs, alerts: st.alerts } }, '*');
      }
    } catch (e) { err('SNAP ' + e.message); }
  }, 100);
})();
