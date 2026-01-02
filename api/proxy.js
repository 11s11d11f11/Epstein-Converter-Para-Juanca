// api/proxy.js - Vercel Serverless - YouTube to MP3
const RAPIDAPI_KEY = '0992c616bamsh5e52d07ff445561p12b1c0jsnd31fd982e16f';
const API_HOST = 'youtube-video-fast-downloader-24-7.p.rapidapi.com';

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

    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ status: 'error', text: 'No URL provided' });
    }
    
    try {
        // Extraer video ID de la URL
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        if (!match) {
            throw new Error('Invalid YouTube URL');
        }
        const videoId = match[1];
        
        console.log('Video ID:', videoId);
        
        // PASO 1: Obtener calidades disponibles
        const qualityRes = await fetch(`https://${API_HOST}/get_available_quality/${videoId}`, {
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': API_HOST
            }
        });
        
        if (!qualityRes.ok) {
            const errText = await qualityRes.text();
            throw new Error(`Quality API error ${qualityRes.status}: ${errText}`);
        }
        
        const qualities = await qualityRes.json();
        console.log('Available qualities:', JSON.stringify(qualities));
        
        // Buscar audio
        const selectedQuality = qualities.find(q => q.type === 'audio');
        
        if (!selectedQuality) {
            throw new Error('No audio quality found');
        }
        
        console.log('Selected audio quality:', selectedQuality.id);
        
        // PASO 2: Solicitar descarga de audio
        const downloadEndpoint = `https://${API_HOST}/download_audio/${videoId}?quality=${selectedQuality.id}`;
        
        console.log('Download endpoint:', downloadEndpoint);
        
        const downloadRes = await fetch(downloadEndpoint, {
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': API_HOST
            }
        });
        
        if (!downloadRes.ok) {
            const errText = await downloadRes.text();
            throw new Error(`Download API error ${downloadRes.status}: ${errText}`);
        }
        
        const downloadData = await downloadRes.json();
        console.log('Download response:', JSON.stringify(downloadData));
        
        if (!downloadData.file) {
            throw new Error('No file URL in response');
        }
        
        // PASO 3: Hacer polling hasta que el archivo este disponible
        const fileUrl = await waitForFile(downloadData.file);
        
        return res.status(200).json({
            status: 'success',
            url: fileUrl,
            title: `audio_${videoId}`
        });

    } catch (err) {
        console.error('Error:', err.message);
        return res.status(503).json({
            status: 'error',
            text: err.message
        });
    }
}

// Polling para esperar que el archivo este disponible
async function waitForFile(fileUrl) {
    console.log('Waiting for file:', fileUrl);
    
    for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 5000)); // Esperar 5 segundos
        
        try {
            const response = await fetch(fileUrl, { method: 'HEAD' });
            console.log('File check attempt', i + 1, 'status:', response.status);
            
            if (response.ok) {
                return fileUrl;
            }
        } catch (e) {
            console.log('File check error:', e.message);
        }
    }
    
    // Devolver URL de todas formas, el usuario puede reintentar
    return fileUrl;
}
