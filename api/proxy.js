// api/proxy.js - Vercel Serverless con RapidAPI
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

    const isAudio = downloadMode === 'audio';
    
    // RapidAPI Key
    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '0992c616bamsh5e52d07ff445561p12b1c0jsnd31fd982e16f';
    
    try {
        console.log('Calling RapidAPI...');
        
        // Llamar a RapidAPI YouTube to MP3
        const response = await fetch('https://youtube-to-mp315.p.rapidapi.com/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': 'youtube-to-mp315.p.rapidapi.com'
            },
            body: JSON.stringify({
                url: url,
                format: isAudio ? 'mp3' : 'mp4',
                quality: 0
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.log('RapidAPI error:', response.status, errorText);
            throw new Error(`RapidAPI HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('RapidAPI response:', data);

        // Si ya está disponible
        if (data.status === 'AVAILABLE' && data.downloadUrl) {
            return res.status(200).json({
                status: 'success',
                url: data.downloadUrl,
                title: data.title || 'video'
            });
        }

        // Si está procesando, hacer polling
        if (data.id && data.status === 'PROCESSING') {
            const downloadUrl = await pollForResult(data.id, RAPIDAPI_KEY);
            return res.status(200).json({
                status: 'success',
                url: downloadUrl,
                title: data.title || 'video'
            });
        }

        // Si hay error
        if (data.status === 'CONVERSION_ERROR') {
            throw new Error('Conversion failed');
        }

        throw new Error('Unexpected response: ' + JSON.stringify(data));

    } catch (err) {
        console.error('Error:', err.message);
        return res.status(503).json({
            status: 'error',
            text: err.message
        });
    }
}

// Polling para esperar resultado
async function pollForResult(id, apiKey) {
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        
        const response = await fetch(`https://youtube-to-mp315.p.rapidapi.com/status/${id}`, {
            headers: {
                'X-RapidAPI-Key': apiKey,
                'X-RapidAPI-Host': 'youtube-to-mp315.p.rapidapi.com'
            }
        });

        if (!response.ok) continue;
        
        const data = await response.json();
        
        if (data.status === 'AVAILABLE' && data.downloadUrl) {
            return data.downloadUrl;
        }
        
        if (data.status === 'CONVERSION_ERROR') {
            throw new Error('Conversion failed');
        }
    }
    
    throw new Error('Timeout waiting for conversion');
}
