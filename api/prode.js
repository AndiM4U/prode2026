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
      const results = await redis.hgetall('results') || {};
      const config  = await redis.get('config') || { rc:'', rg:'', sections:{s1:true,s2:false,extra:false} };
      const fixtures = await redis.lrange('fixtures2', 0, -1) || [];
      const matchKeys = await redis.smembers('match-keys') || [];
      const predictions = {};
      if (matchKeys.length) {
        await Promise.all(matchKeys.map(async k => {
          const v = await redis.hgetall(k);
          if (v) predictions[k.replace('preds:', '')] = v;
        }));
      }
      return res.json({ players: players||{}, results: results||{}, config, fixtures, predictions });
    }

    if (action === 'join') {
      const { name, lastSeen } = req.body;
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });

      // Case-insensitive lookup: find existing player ignoring case/spacing
      const allPlayers = await redis.hgetall('players') || {};
      const normalizedInput = name.trim().toLowerCase().replace(/\s+/g,' ');
      let matchedKey = null;
      let existingData = null;
      for (const key of Object.keys(allPlayers)) {
        const normalizedKey = key.trim().toLowerCase().replace(/\s+/g,' ');
        if (normalizedKey === normalizedInput) {
          matchedKey = key;
          const raw = allPlayers[key];
          existingData = typeof raw === 'string' ? JSON.parse(raw) : raw;
          break;
        }
      }

      // Use the EXISTING stored name if found (preserves original casing/predictions),
      // otherwise use the newly provided name
      const finalName = matchedKey || name;

      const updated = {
        name: finalName,
        champ: existingData?.champ || '',
        goleador: existingData?.goleador || '',
        joined: existingData?.joined || Date.now(),
        lastSeen: lastSeen || Date.now()
      };

      await redis.hset('players', { [finalName]: JSON.stringify(updated) });
      return res.json({ ok:true, player: updated });
    }

    if (action === 'save-player') {
      const { name, champ, goleador } = req.body;
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });
      const existing = await redis.hget('players', name);
      const existingData = existing ? (typeof existing==='string' ? JSON.parse(existing) : existing) : {};
      await redis.hset('players', { [name]: JSON.stringify({ ...existingData, name, champ, goleador }) });
      return res.json({ ok:true });
    }

    if (action === 'save-preds') {
      const { name, preds } = req.body;
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });
      const key = 'preds:' + name;
      // Merge with existing preds instead of overwriting
      if (Object.keys(preds).length) {
        await redis.hset(key, preds);
        await redis.sadd('match-keys', key);
      }
      return res.json({ ok:true });
    }

    if (action === 'get-preds') {
      const { name } = req.query;
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });
      const data = await redis.hgetall('preds:' + name) || {};
      return res.json({ preds: data||{} });
    }

    if (action === 'add-result') {
      const { pass, id, teamA, teamB, sa, sb } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      await redis.hset('results', { [id]: JSON.stringify({ id, teamA, teamB, sa: parseInt(sa), sb: parseInt(sb) }) });
      return res.json({ ok:true });
    }

    if (action === 'delete-result') {
      const { pass, id } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      await redis.hdel('results', id);
      return res.json({ ok:true });
    }

    if (action === 'add-fixture') {
      const { pass, section, id, teamA, teamB, label, slotKey } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      const key = 'fixtures' + (section||2);
      const existing = await redis.lrange(key, 0, -1) || [];
      const parsed = existing.map(x => typeof x==='string' ? JSON.parse(x) : x);
      if (!parsed.find(f => f.id === id)) {
        await redis.rpush(key, JSON.stringify({ id, teamA, teamB, label, slotKey: slotKey||'' }));
      }
      return res.json({ ok:true });
    }

    if (action === 'set-fixtures2') {
      const { pass, fixtures } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      await redis.del('fixtures2');
      if (fixtures && fixtures.length) {
        await redis.rpush('fixtures2', ...fixtures.map(f => JSON.stringify(f)));
      }
      return res.json({ ok:true });
    }

    if (action === 'delete-fixture') {
      const { pass, section, id } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      const key = 'fixtures' + section;
      const existing = await redis.lrange(key, 0, -1) || [];
      const parsed = existing.map(x => typeof x==='string' ? JSON.parse(x) : x);
      const filtered = parsed.filter(f => f.id !== id);
      await redis.del(key);
      if (filtered.length) await redis.rpush(key, ...filtered.map(f => JSON.stringify(f)));
      await redis.hdel('results', id);
      return res.json({ ok:true });
    }

    if (action === 'save-config') {
      const { pass, rc, rg, sections } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      await redis.set('config', JSON.stringify({ rc, rg, sections: sections||{s1:true,s2:false} }));
      return res.json({ ok:true });
    }

    if (action === 'delete-player') {
      const { pass, name } = req.body;
      if (pass !== ORG_PASS) return res.status(403).json({ error: 'Sin autorización' });
      await redis.hdel('players', name);
      await redis.del('preds:' + name);
      await redis.srem('match-keys', 'preds:' + name);
      return res.json({ ok:true });
    }

    return res.status(404).json({ error: 'Acción no encontrada' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error del servidor', detail: err.message });
  }
};
