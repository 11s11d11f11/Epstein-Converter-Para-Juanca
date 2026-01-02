// api/proxy.js - Vercel Serverless Function
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ status: 'error', text: 'Method not allowed' });
    }

    const { url, downloadMode } = req.body;

    if (!url) {
        return res.status(400).json({ status: 'error', text: 'No URL provided' });
    }

    // Instancias de Cobalt (las mas abiertas primero)
    const cobaltInstances = [
        'https://cobalt.perennialte.ch/api/json',
        'https://cobalt.hypert.net/api/json',
        'https://co.e96.one/api/json',
        'https://api.cobalt.tools/api/json'
    ];

    const payload = {
        url: url,
        videoQuality: '720',
        downloadMode: downloadMode || 'auto',
        audioFormat: 'mp3',
        filenamePattern: 'basic'
    };

    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    let lastError = null;

    // Intentar cada instancia
    for (const instance of cobaltInstances) {
        try {
            console.log('Trying:', instance);
            
            const response = await fetch(instance, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': randomUA,
                    'Origin': 'https://cobalt.tools',
                    'Referer': 'https://cobalt.tools/'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Success from:', instance);
                return res.status(200).json(data);
            }

            lastError = `${instance} -> HTTP ${response.status}`;
            console.log(lastError);

        } catch (err) {
            lastError = `${instance} -> ${err.message}`;
            console.log(lastError);
        }
    }

    return res.status(503).json({
        status: 'error',
        text: 'All Cobalt instances failed: ' + lastError
    });
}
