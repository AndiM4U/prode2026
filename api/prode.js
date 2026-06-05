const { Redis } = require('@upstash/redis');
const redis = Redis.fromEnv();
const ORG_PASS = process.env.ORG_PASSWORD || 'mundial2026';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { action } = req.query;
  try {
    if (action === 'get-all') {
      const players = await redis.hgetall('players') || {};
      const results = await redis.lrange('results', 0, -1) || [];
      const config = await redis.get('config') || { w:1, e:3, c:10, g:5, rc:'', rg:'' };
      const matchKeys = await redis.smembers('match-keys') || [];
      const matches = {};
      if (matchKeys.length) {
        await Promise.all(matchKeys.map(async k => {
          const v = await redis.hgetall(k);
          if (v) matches[k.replace('matches:', '')] = v;
        }));
      }
      return res.json({ players: players || {}, results: results || [], config, matches });
    }
    if (action === 'join') {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });
      const existing = await redis.hget('players', name);
      if (!existing) {
        await redis.hset('players', { [name]: JSON.stringify({ name, champ: '', goleador: '', joined: Date.now() }) });
      }
      return res.json({ ok: true, player: existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : { name, champ: '', goleador: '' } });
    }
    if (action === 'save-player') {
      const { name, champ, goleador } = req.body;
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });
      await redis.hset('players', { [name]: JSON.stringify({ name, champ, goleador }) });
      return res.json({ ok: true });
    }
    if (action === 'save-matches') {
      const { name, matches } = req.body;
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });
      const key = 'matches:' + name;
      await redis.del(key);
      if (Object.keys(matches).length) {
        await redis.hset(key, matches);
        await redis.sadd('match-keys', key);
      }
      return res.json({ ok: true });
    }
    if (action === 'get-matches') {
      const { name } = req.query;
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });
      const data = await redis.hgetall('matches:' + name) || {};
      return res.json({ matches: data || {} });
    }
    if (action === 'add-result') {
      const { pass, teamA, teamB, sa, sb, id } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      const results = await redis.lrange('results', 0, -1) || [];
      const parsed = results.map(r => typeof r === 'string' ? JSON.parse(r) : r);
      const idx = parsed.findIndex(r => r.id === id);
      const entry = JSON.stringify({ id, teamA, teamB, sa: parseInt(sa), sb: parseInt(sb) });
      if (idx >= 0) { await redis.lset('results', idx, entry); }
      else { await redis.rpush('results', entry); }
      return res.json({ ok: true });
    }
    if (action === 'delete-result') {
      const { pass, id } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      const results = await redis.lrange('results', 0, -1) || [];
      const parsed = results.map(r => typeof r === 'string' ? JSON.parse(r) : r);
      const filtered = parsed.filter(r => r.id !== id);
      await redis.del('results');
      if (filtered.length) await redis.rpush('results', ...filtered.map(r => JSON.stringify(r)));
      return res.json({ ok: true });
    }
    if (action === 'save-config') {
      const { pass, ...cfg } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      await redis.set('config', JSON.stringify(cfg));
      return res.json({ ok: true });
    }
    if (action === 'delete-player') {
      const { pass, name } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      await redis.hdel('players', name);
      await redis.del('matches:' + name);
      await redis.srem('match-keys', 'matches:' + name);
      return res.json({ ok: true });
    }
    return res.status(404).json({ error: 'Acción no encontrada' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error del servidor', detail: err.message });
  }
};
