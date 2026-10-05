import { authorized, loadState, saveState, updatePosition } from './_state.js';

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'invalid password' });

  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return res.json(await loadState());
    if (req.method === 'PUT') return res.json(await saveState(req.body));
    if (req.method === 'PATCH') return res.json(await updatePosition(req.body?.symbol, req.body?.changes));
    return res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
}
