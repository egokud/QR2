export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
  if (!SCRIPT_URL) {
    return res.status(500).json({ error: 'GOOGLE_SCRIPT_URL not set' });
  }

  const params = new URLSearchParams(req.query).toString();
  const url = SCRIPT_URL + (params ? '?' + params : '');

  try {
    const response = await fetch(url, { redirect: 'follow' });
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
