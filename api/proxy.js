// api/proxy.js - Vercel Serverless con YouTube Video FAST Downloader 24/7
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

    const { url, downloadMode } = req.body;

    if (!url) {
        return res.status(400).json({ status: 'error', text: 'No URL provided' });
    }

    const isAudio = downloadMode === 'audio';
    
    try {
        // Extraer video ID de la URL
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        if (!match) {
            throw new Error('Invalid YouTube URL');
        }
        const videoId = match[1];
        const isShort = url.includes('/shorts/');
        
        console.log('Video ID:', videoId, 'isAudio:', isAudio, 'isShort:', isShort);
        
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
        
        // Seleccionar la mejor calidad segun tipo
        let selectedQuality;
        if (isAudio) {
            // Buscar audio
            selectedQuality = qualities.find(q => q.type === 'audio');
        } else {
            // Buscar video, preferir 720p o 480p o la mejor disponible
            const videoQualities = qualities.filter(q => q.type === 'video');
            selectedQuality = videoQualities.find(q => q.quality === '720p') ||
                              videoQualities.find(q => q.quality === '480p') ||
                              videoQualities.find(q => q.quality === '360p') ||
                              videoQualities[0];
        }
        
        if (!selectedQuality) {
            throw new Error('No suitable quality found');
        }
        
        console.log('Selected quality:', selectedQuality.id, selectedQuality.quality);
        
        // PASO 2: Solicitar descarga
        let downloadEndpoint;
        if (isAudio) {
            downloadEndpoint = `https://${API_HOST}/download_audio/${videoId}?quality=${selectedQuality.id}`;
        } else if (isShort) {
            downloadEndpoint = `https://${API_HOST}/download_short/${videoId}?quality=${selectedQuality.id}`;
        } else {
            downloadEndpoint = `https://${API_HOST}/download_video/${videoId}?quality=${selectedQuality.id}`;
        }
        
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
            title: `video_${videoId}`,
            quality: selectedQuality.quality
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
