// Twitch plugin for Couchmate.
// - "Twitch" in the app menu: a front page like twitch.tv – featured streams, your channels, popular streams
//   in your language, top categories (each opens a page with its streams) and a row per big category.
// - Search in the app finds Twitch categories and channels that are live right now.
// - The live stream plays in sync for everyone, with the chat next to it.
//
// Data comes from Twitch's public web interface (the same way Streamlink and VLC do it),
// so no Twitch account is needed. If Twitch changes something, the client ID can be changed in the settings.

const GQL = 'https://gql.twitch.tv/gql';
const USHER = 'https://usher.ttvnw.net/api/channel/hls';
const CHAT = 'wss://irc-ws.chat.twitch.tv:443';
const LOGO = 'M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2 3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43z';
const DEFAULT_CLIENT = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const LOGIN = /^[A-Za-z0-9_]{1,40}$/;

export default function setup(api) {
  const open = new Set(); // open chats (stop functions)
  const clientId = () => api.settings.clientId || DEFAULT_CLIENT;

  async function gql(query, variables = {}) {
    const r = await fetch(GQL, {
      method: 'POST',
      headers: { 'Client-ID': clientId(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Twitch answered ${r.status}`);
    const d = await r.json();
    if (d.errors?.length) throw new Error(d.errors[0].message || 'Twitch returned an error');
    return d.data;
  }

  const STREAM_FIELDS = `
    id title viewersCount previewImageURL(width: 640, height: 360)
    freeformTags { name }
    broadcaster { login displayName profileImageURL(width: 70) }
    game { id displayName }`;

  const GAME_FIELDS = 'id name displayName viewersCount boxArtURL(width: 285, height: 380)';

  // Twitch replaces the preview about every five minutes – add a timestamp so it is not cached too long.
  const fresh = (u) => (u ? `${u}${u.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 300000)}` : null);

  const compact = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 10_000 ? `${Math.floor(n / 1000)} k` : n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n));
  const viewersText = (n) => api.t('{n} viewers', { n: compact(n || 0) });

  const toItem = (s) => s?.broadcaster?.login && {
    id: s.broadcaster.login,
    kind: 'stream',
    live: true,
    title: s.title || s.broadcaster.displayName,
    subtitle: [s.broadcaster.displayName, s.game?.displayName].filter(Boolean).join(' · '),
    image: fresh(s.previewImageURL),
    viewers: s.viewersCount,
    // Only used by this plugin's own cards:
    channel: s.broadcaster.displayName,
    game: s.game?.displayName || '',
    avatar: s.broadcaster.profileImageURL || null,
    tags: (s.freeformTags || []).slice(0, 3).map((t) => t.name).join(' · '),
    viewersText: viewersText(s.viewersCount),
  };

  /** A category (game) – OK opens its page with every live stream in it. */
  const toCategory = (g) => g?.id && {
    id: String(g.id),
    kind: 'category',
    action: 'open',
    view: 'category',
    title: g.displayName || g.name,
    subtitle: viewersText(g.viewersCount),
    image: g.boxArtURL || null,
    viewersText: viewersText(g.viewersCount),
    favorite: false,
  };

  const streams = (edges) => (edges || []).map((e) => toItem(e.node)).filter(Boolean);
  const message = (text) => ({ type: 'column', padding: 20, children: [{ type: 'text', text, style: 'dim' }] });

  // A stream card like on twitch.tv: the preview with LIVE and viewers, then the channel's picture, its name,
  // the stream's title and the category. The big one (featured) also shows the stream's tags.
  const streamCard = (big) => ({
    type: 'column', children: [
      {
        type: 'box', aspect: 1.7778, width: 'fill', children: [
          { type: 'image', src: '{{item.image}}', fallback: '{{item.channel}}', fit: 'cover', width: 'fill', height: 'fill', radius: 12 },
          {
            type: 'row', align: 'topStart', padding: 8, gap: 6, children: [
              { type: 'badge', text: 'LIVE', color: 'live' },
              { type: 'badge', text: '{{item.viewersText}}', color: 'dark' },
            ],
          },
          { type: 'badge', text: '★', color: 'dark', textColor: 'gold', align: 'topEnd', padding: 6, when: '{{item.$favorite}}' },
        ],
      },
      {
        type: 'row', padding: [12, 10, 12, 10], gap: 12, children: [
          { type: 'image', src: '{{item.avatar}}', fallback: '{{item.channel}}', fit: 'cover', width: big ? 48 : 38, height: big ? 48 : 38, radius: big ? 24 : 19 },
          {
            type: 'column', weight: 1, children: [
              { type: 'text', text: '{{item.channel}}', style: 'bodyStrong', size: big ? 17 : 15, maxLines: 1 },
              { type: 'text', text: '{{item.title}}', size: big ? 14 : 13, maxLines: big ? 2 : 1, padding: [0, 2, 0, 0] },
              { type: 'text', text: '{{item.game}}', style: 'dim', size: 12, maxLines: 1, padding: [0, 2, 0, 0] },
              ...(big ? [{ type: 'text', text: '{{item.tags}}', color: 'accent', size: 12, maxLines: 1, padding: [0, 4, 0, 0] }] : []),
            ],
          },
        ],
      },
    ],
  });

  // A category card: the cover, the name and how many are watching.
  const categoryCard = {
    type: 'column', children: [
      { type: 'box', aspect: 0.75, width: 'fill', children: [
        { type: 'image', src: '{{item.image}}', fallback: '{{item.title}}', fit: 'cover', width: 'fill', height: 'fill', radius: 10 },
      ] },
      {
        type: 'column', padding: [10, 6, 10, 4], children: [
          { type: 'text', text: '{{item.title}}', style: 'bodyStrong', size: 14, maxLines: 1 },
          { type: 'text', text: '{{item.viewersText}}', style: 'dim', size: 12, maxLines: 1 },
        ],
      },
    ],
  };

  // On top of the video: who did what, the channel and the stream, LIVE and the key hints.
  const overlay = {
    type: 'box', width: 'fill', height: 'fill', children: [
      { type: 'topbar', align: 'topStart' },
      {
        type: 'column', align: 'bottomStart', width: 'fill', background: 'bottomFade', padding: [56, 80, 56, 40], children: [
          {
            type: 'row', align: 'center', children: [
              { type: 'image', src: '{{media.image}}', fallback: '{{media.subtitle}}', fit: 'cover', width: 150, height: 84, radius: 10 },
              { type: 'spacer', width: 24 },
              {
                type: 'column', weight: 1, children: [
                  {
                    type: 'row', align: 'center', children: [
                      { type: 'text', text: '{{media.subtitle || media.title}}', style: 'title', size: 22, maxLines: 1 },
                      { type: 'spacer', width: 12 },
                      { type: 'badge', text: 'LIVE', color: 'live' },
                    ],
                  },
                  { type: 'spacer', height: 6 },
                  { type: 'text', text: '{{media.title}}', style: 'dim', size: 18, maxLines: 2, when: '{{media.subtitle}}' },
                ],
              },
            ],
          },
          { type: 'spacer', height: 16 },
          {
            type: 'row', children: [
              { type: 'text', text: '{{player.status}}', color: 'status', size: 14 },
              { type: 'spacer', weight: 1 },
              { type: 'text', text: '{{player.hints}}', style: 'faint', size: 13 },
            ],
          },
        ],
      },
    ],
  };

  /** A channel that is not live: its name and picture, so it can be found and kept as a favourite. */
  const offlineItem = (u) => u?.login && {
    id: u.login,
    kind: 'stream',
    live: false,
    title: u.displayName || u.login,
    subtitle: api.t('Not live right now'),
    image: u.offlineImageURL || u.bigAvatar || u.profileImageURL || null,
  };

  /**
   * Favourite channels right now: live ones with what they stream, the others as offline.
   * → { login: { live, title, subtitle, image, viewers } }
   */
  async function channelStatus(logins) {
    const out = {};
    for (let i = 0; i < logins.length; i += 50) {
      const d = await gql(`query($logins: [String!]) { users(logins: $logins) {
        login displayName offlineImageURL bigAvatar: profileImageURL(width: 300) stream { ${STREAM_FIELDS} } } }`, { logins: logins.slice(i, i + 50) });
      for (const u of d.users || []) {
        if (!u?.login) continue;
        if (u.stream) {
          const it = toItem({ ...u.stream, broadcaster: { login: u.login, displayName: u.displayName, profileImageURL: u.bigAvatar } });
          out[u.login] = { live: true, title: it.title, subtitle: it.subtitle, image: it.image, viewers: it.viewers };
        } else {
          const it = offlineItem(u);
          out[u.login] = { live: false, title: it.title, subtitle: it.subtitle, image: it.image, viewers: null };
        }
      }
    }
    return out;
  }

  async function channels(logins) {
    if (!logins.length) return [];
    const d = await gql(`query($logins: [String!]) { users(logins: $logins) { login displayName profileImageURL(width: 70) stream { ${STREAM_FIELDS} } } }`, { logins });
    return (d.users || []).filter((u) => u?.stream)
      .map((u) => toItem({ ...u.stream, broadcaster: { login: u.login, displayName: u.displayName, profileImageURL: u.profileImageURL } }))
      .filter(Boolean);
  }

  /** The language for the extra row: the setting, or the device's language with "auto" (none for English). */
  function rowLanguage(ctx) {
    const set = String(api.settings.language ?? 'auto').trim().toLowerCase() || 'auto';
    const l = set === 'auto' ? String(ctx?.lang || '').toLowerCase() : set;
    if (!/^[a-z]{2}$/.test(l)) return null;
    return set === 'auto' && l === 'en' ? null : l;
  }

  /** "svenska", "Swedish" … – the language's name in the device's language. */
  const languageName = (code, ui) => {
    try { return new Intl.DisplayNames([ui || 'en'], { type: 'language' }).of(code) || code.toUpperCase(); } catch { return code.toUpperCase(); }
  };

  /** Everything on the front page, in a few requests. */
  async function frontPage(ctx) {
    const s = api.settings;
    const lang = rowLanguage(ctx);
    const own = String(s.channels || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => LOGIN.test(x));
    const count = Math.min(30, Math.max(6, Number(s.count) || 30));
    const catRows = Math.min(6, Math.max(0, Number(s.categoryRows ?? 3)));
    const [d, mine] = await Promise.all([
      gql(`query($first: Int!${lang ? ', $lang: Language!' : ''}) {
        top: streams(first: $first) { edges { node { ${STREAM_FIELDS} } } }
        ${lang ? `local: streams(first: 24, options: { broadcasterLanguages: [$lang] }) { edges { node { ${STREAM_FIELDS} } } }` : ''}
        games(first: 24) { edges { node { ${GAME_FIELDS} } } }
      }`, lang ? { first: count, lang: lang.toUpperCase() } : { first: count }),
      channels(own).catch((e) => { api.log(`your channels: ${e.message}`); return []; }),
    ]);
    const games = (d.games?.edges || []).map((e) => e.node).filter((g) => g?.id);
    const top = streams(d.top?.edges);

    // A row for each of the biggest categories (one request, with aliases).
    const picked = games.slice(0, catRows);
    let perGame = {};
    if (picked.length) {
      const q = picked.map((g, i) => `g${i}: game(id: "${String(g.id).replace(/\D/g, '')}") { streams(first: 16) { edges { node { ${STREAM_FIELDS} } } } }`).join('\n');
      perGame = await gql(`{ ${q} }`).catch((e) => { api.log(`category rows: ${e.message}`); return {}; });
    }

    const rows = [];
    if (top.length) rows.push({ id: 'featured', kind: 'featured', title: api.t('Featured'), items: top.slice(0, 6) });
    if (mine.length) rows.push({ id: 'mine', kind: 'streams', title: api.t('Your channels'), items: mine });
    const local = streams(d.local?.edges);
    if (local.length) rows.push({ id: 'lang', kind: 'streams', title: api.t('Popular in {language}', { language: languageName(lang, ctx?.lang) }), items: local });
    if (games.length) rows.push({ id: 'categories', kind: 'categories', title: api.t('Top categories'), items: games.map(toCategory).filter(Boolean) });
    if (top.length > 6) rows.push({ id: 'top', kind: 'streams', title: api.t('Popular right now'), items: top.slice(6) });
    picked.forEach((g, i) => {
      const items = streams(perGame[`g${i}`]?.streams?.edges);
      if (items.length) rows.push({ id: `game-${g.id}`, kind: 'streams', title: g.displayName || g.name, items });
    });
    return rows.map((r) => ({ ...r, [`is_${r.kind}`]: true }));
  }

  /** A horizontal row on the front page, drawn the way the row's kind says. */
  const rowList = (kind, extra) => ({
    type: 'list', id: 'row-{{item.id}}', direction: 'horizontal', items: '{{item.items}}', gap: 16, padding: [12, 10, 12, 10],
    when: `{{item.is_${kind}}}`, ...extra,
  });

  async function mainView(ctx) {
    const rows = await frontPage(ctx);
    return {
      type: 'column', refresh: 90, children: [
        {
          type: 'row', align: 'center', padding: [12, 0, 0, 10], children: [
            { type: 'icon', path: LOGO, size: 28, color: 'accent' },
            { type: 'spacer', width: 12 },
            { type: 'text', text: 'Twitch', style: 'title', size: 26 },
          ],
        },
        {
          type: 'list', id: 'rows', weight: 1, items: rows, focus: 'none', gap: 14,
          empty: api.t('Nothing here.'),
          item: {
            type: 'column', children: [
              { type: 'text', text: '{{item.title}}', style: 'headline', size: 20, padding: [12, 0, 0, 8] },
              rowList('featured', { focus: 'card', itemWidth: 480, onClick: { play: '{{item}}' }, onLongClick: { favorite: '{{item}}' }, item: streamCard(true) }),
              rowList('streams', { focus: 'card', itemWidth: 320, onClick: { play: '{{item}}' }, onLongClick: { favorite: '{{item}}' }, item: streamCard(false) }),
              rowList('categories', { focus: 'card', itemWidth: 170, onClick: { open: 'category', params: { id: '{{item.id}}' } }, item: categoryCard }),
            ],
          },
        },
      ],
    };
  }

  /** A category's page: its cover, name and viewers, then its live streams (the device's language first). */
  async function categoryView(id, ctx) {
    const gid = String(id || '').replace(/\D/g, '');
    if (!gid) return message(api.t('Nothing here.'));
    const lang = rowLanguage(ctx);
    const d = await gql(`query($id: ID!${lang ? ', $lang: Language!' : ''}) {
      game(id: $id) {
        ${GAME_FIELDS}
        all: streams(first: 30) { edges { node { ${STREAM_FIELDS} } } }
        ${lang ? `local: streams(first: 30, options: { broadcasterLanguages: [$lang] }) { edges { node { ${STREAM_FIELDS} } } }` : ''}
      }
    }`, lang ? { id: gid, lang: lang.toUpperCase() } : { id: gid });
    const g = d.game;
    if (!g) return message(api.t('Nothing here.'));
    const local = streams(g.local?.edges);
    const seen = new Set(local.map((x) => x.id));
    const list = [...local, ...streams(g.all?.edges).filter((x) => !seen.has(x.id))];
    return {
      type: 'column', refresh: 90, children: [
        {
          type: 'row', align: 'center', padding: [8, 0, 14, 10], gap: 18, children: [
            { type: 'image', src: g.boxArtURL, fallback: g.displayName || g.name, fit: 'cover', width: 72, height: 96, radius: 8 },
            {
              type: 'column', weight: 1, children: [
                { type: 'text', text: g.displayName || g.name, style: 'title', size: 26, maxLines: 1 },
                { type: 'text', text: viewersText(g.viewersCount), style: 'dim', size: 15 },
              ],
            },
          ],
        },
        {
          type: 'grid', id: 'streams', weight: 1, items: list, focus: 'card', minWidth: 320, gap: 16, rowGap: 18, padding: [4, 10, 24, 10],
          autofocus: true, empty: api.t('No one is streaming this right now'),
          onClick: { play: '{{item}}' }, onLongClick: { favorite: '{{item}}' },
          item: streamCard(false),
        },
      ],
    };
  }

  api.source({
    name: 'Twitch',
    icon: LOGO,
    // On the Favorites screen: favourite channels in a group of their own (live ones first).
    favoriteGroups: { stream: { title: api.t('Twitch channels'), order: 35 } },

    // The player: this plugin decides the keys and what is in the settings panel.
    player: {
      keys: { ok: 'pause', down: 'settings', right: 'chat', left: 'none', up: 'info' },
      overlay,
      settings: [
        { type: 'chat', title: api.t('Chat') },
        { type: 'quality', title: api.t('Quality') },
        {
          type: 'choice', id: 'latency', title: api.t('Latency'), default: 'low',
          options: [{ id: 'low', label: api.t('Low (closer to live)') }, { id: 'normal', label: api.t('Normal (more stable)') }],
        },
      ],
    },

    /** The Twitch pages, built here from building blocks; the apps draw them. */
    async view(id, params = {}, ctx = {}) {
      if (id === 'category') return categoryView(params.id, ctx);
      return mainView(ctx);
    },

    /** Search: categories first, then channels that are live (Twitch also matches the streams' titles). */
    async search(q) {
      const d = await gql(`query($q: String!) {
        searchFor(userQuery: $q, platform: "web") {
          games { edges { item { ... on Game { ${GAME_FIELDS} } } } }
          channels { edges { item { ... on User { login displayName offlineImageURL profileImageURL(width: 70) bigAvatar: profileImageURL(width: 300) stream { ${STREAM_FIELDS} } } } } }
        }
      }`, { q });
      const categories = (d.searchFor?.games?.edges || []).map((e) => e.item)
        .filter((g) => g?.viewersCount > 0).slice(0, 12).map(toCategory).filter(Boolean);
      const live = (d.searchFor?.channels?.edges || [])
        .map((e) => e.item)
        .filter((u) => u?.stream)
        .map((u) => toItem({ ...u.stream, broadcaster: { login: u.login, displayName: u.displayName, profileImageURL: u.profileImageURL } }))
        .filter(Boolean);
      // Channels that are offline too – so they can be added to favourites (hold OK) and followed there.
      const offline = (d.searchFor?.channels?.edges || []).map((e) => e.item).filter((u) => u?.login && !u.stream)
        .slice(0, 12).map(offlineItem).filter(Boolean);
      return {
        sections: [
          { id: 'categories', title: api.t('Categories'), style: 'poster', items: categories },
          { id: 'channels', title: api.t('Live channels'), items: live },
          { id: 'offline', title: api.t('Offline channels'), items: offline },
        ],
      };
    },

    /** A favourite is the channel – not the stream that is on right now (its title and preview change). */
    async favorite(item) {
      const login = String(item.id || '').toLowerCase();
      if (!LOGIN.test(login)) return null;
      const st = (await channelStatus([login]).catch(() => ({})))[login];
      return { ...item, id: login, kind: 'stream', action: 'play', ...(st || {}) };
    },

    /** Favourites: which channels are live now (the server asks every few minutes). */
    async status(ids) {
      return channelStatus(ids.map((x) => String(x).toLowerCase()).filter((x) => LOGIN.test(x)));
    },

    async resolve(login, { options = {} } = {}) {
      if (!LOGIN.test(login)) throw new Error('Invalid channel name');
      const d = await gql(`query($login: String!) {
        streamPlaybackAccessToken(channelName: $login, params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) { value signature }
        user(login: $login) { displayName stream { title game { displayName } } }
      }`, { login: login.toLowerCase() });
      const tok = d.streamPlaybackAccessToken;
      if (!tok || !d.user?.stream) throw new Error('The channel is not live right now');
      const qs = new URLSearchParams({
        sig: tok.signature, token: tok.value, allow_source: 'true', allow_audio_only: 'true',
        fast_bread: options.latency === 'normal' ? 'false' : 'true', p: String(Math.floor(Math.random() * 1e7)),
      });
      return {
        url: `${USHER}/${login.toLowerCase()}.m3u8?${qs}`,
        type: 'hls',
        live: true,
        kind: 'stream',
        title: d.user.stream.title || d.user.displayName,
        subtitle: [d.user.displayName, d.user.stream.game?.displayName].filter(Boolean).join(' · '),
      };
    },

    /** Live chat: reads the channel's chat anonymously (read only, no account). */
    chat(login, onMessage) {
      if (!LOGIN.test(login)) throw new Error('Invalid channel name');
      const chan = login.toLowerCase();
      let ws = null;
      let stopped = false;
      let retry = null;
      let wait = 2000;
      const connect = () => {
        ws = new WebSocket(CHAT);
        ws.onopen = () => {
          wait = 2000;
          ws.send('CAP REQ :twitch.tv/tags');
          ws.send('PASS SCHMOOPIIE');
          ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
          ws.send(`JOIN #${chan}`);
        };
        ws.onmessage = (ev) => {
          for (const line of String(ev.data).split('\r\n')) {
            if (!line) continue;
            if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); continue; }
            const m = /^(?:@(\S+) )?:([^!\s]+)!\S+ PRIVMSG #\S+ :(.*)$/.exec(line);
            if (!m) continue;
            const tags = Object.fromEntries((m[1] || '').split(';').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
            let text = m[3];
            const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
            if (action) text = action[1];
            const user = (tags['display-name'] || m[2]).replace(/\s/g, ' ');
            onMessage({ user, color: tags.color || null, text });
          }
        };
        ws.onclose = () => {
          if (stopped) return;
          retry = setTimeout(connect, wait);
          wait = Math.min(wait * 2, 60000);
        };
        ws.onerror = () => { /* onclose follows */ };
      };
      connect();
      const stop = () => {
        stopped = true;
        clearTimeout(retry);
        try { ws?.close(); } catch { /* already closed */ }
        open.delete(stop);
      };
      open.add(stop);
      return stop;
    },
  });

  // Close every chat when the plugin is switched off.
  return () => { for (const stop of [...open]) stop(); };
}
