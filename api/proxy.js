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
    const RAPIDAPI_KEY = '0992c616bamsh5e52d07ff445561p12b1c0jsnd31fd982e16f';
    
    try {
        // La API usa "videoId" no "url" segun documentacion
        // Extraer video ID de la URL
        let videoId = url;
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        if (match) {
            videoId = match[1];
        }
        
        console.log('Video ID:', videoId);
        console.log('Format:', isAudio ? 'mp3' : 'mp4');
        
        // Probar con el endpoint correcto segun RapidAPI docs
        const apiUrl = `https://youtube-to-mp315.p.rapidapi.com/download?url=${encodeURIComponent(url)}&format=${isAudio ? 'mp3' : 'mp4'}`;
        
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': 'youtube-to-mp315.p.rapidapi.com'
            }
        });

        const responseText = await response.text();
        console.log('RapidAPI status:', response.status);
        console.log('RapidAPI response:', responseText);
        
        if (!response.ok) {
            throw new Error(`API error ${response.status}: ${responseText}`);
        }

        const data = JSON.parse(responseText);

        // Si ya tiene URL de descarga
        if (data.downloadUrl || data.link || data.url) {
            return res.status(200).json({
                status: 'success',
                url: data.downloadUrl || data.link || data.url,
                title: data.title || 'video'
            });
        }
        
        // Si tiene ID, hacer polling
        if (data.id) {
            const result = await pollForResult(data.id, RAPIDAPI_KEY);
            return res.status(200).json({
                status: 'success',
                url: result.downloadUrl || result.link,
                title: result.title || data.title || 'video'
            });
        }

        throw new Error(data.error || data.message || 'No download URL');

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
        console.log('Poll status:', data.status);
        
        if (data.status === 'AVAILABLE' || data.downloadUrl || data.link) {
            return data;
        }
        
        if (data.status === 'CONVERSION_ERROR' || data.error) {
            throw new Error('Conversion failed');
        }
    }
    
    throw new Error('Timeout');
}
