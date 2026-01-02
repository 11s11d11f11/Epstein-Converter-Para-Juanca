// api/proxy.js - Vercel Serverless - YouTube to MP3/MP4
const RAPIDAPI_KEY = '0992c616bamsh5e52d07ff445561p12b1c0jsnd31fd982e16f';

// APIs
const MP3_API_HOST = 'youtube-video-fast-downloader-24-7.p.rapidapi.com';
const MP4_API_HOST = 'youtube-mp41.p.rapidapi.com';

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

    const isVideo = downloadMode === 'video';
    
    try {
        // Extraer video ID de la URL
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        if (!match) {
            throw new Error('Invalid YouTube URL');
        }
        const videoId = match[1];
        
        console.log('Video ID:', videoId, 'Mode:', isVideo ? 'MP4' : 'MP3');
        
        if (isVideo) {
            // Usar youtube-mp41 API para video
            return await downloadVideo(videoId, res);
        } else {
            // Usar youtube-video-fast-downloader para audio
            return await downloadAudio(videoId, res);
        }

    } catch (err) {
        console.error('Error:', err.message);
        return res.status(503).json({
            status: 'error',
            text: err.message
        });
    }
}

// Descargar VIDEO con youtube-mp41 API
async function downloadVideo(videoId, res) {
    // PASO 1: Iniciar descarga
    const downloadUrl = `https://${MP4_API_HOST}/api/v1/download?id=${videoId}&quality=720`;
    console.log('MP4 Download URL:', downloadUrl);
    
    const downloadRes = await fetch(downloadUrl, {
        headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': MP4_API_HOST
        }
    });
    
    if (!downloadRes.ok) {
        const errText = await downloadRes.text();
        throw new Error(`MP4 API error ${downloadRes.status}: ${errText}`);
    }
    
    const downloadData = await downloadRes.json();
    console.log('MP4 Download response:', JSON.stringify(downloadData));
    
    // Si ya tiene URL de descarga directa
    if (downloadData.url || downloadData.downloadUrl || downloadData.link) {
        return res.status(200).json({
            status: 'success',
            url: downloadData.url || downloadData.downloadUrl || downloadData.link,
            title: downloadData.title || `video_${videoId}`
        });
    }
    
    // Si tiene ID, hacer polling con /progress
    const taskId = downloadData.id || downloadData.taskId || videoId;
    console.log('Task ID for polling:', taskId);
    
    // PASO 2: Polling para esperar resultado
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        
        const progressUrl = `https://${MP4_API_HOST}/api/v1/progress?id=${taskId}`;
        const progressRes = await fetch(progressUrl, {
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': MP4_API_HOST
            }
        });
        
        if (!progressRes.ok) continue;
        
        const progressData = await progressRes.json();
        console.log('Progress:', JSON.stringify(progressData));
        
        // Verificar si está listo
        if (progressData.url || progressData.downloadUrl || progressData.link) {
            return res.status(200).json({
                status: 'success',
                url: progressData.url || progressData.downloadUrl || progressData.link,
                title: progressData.title || `video_${videoId}`
            });
        }
        
        // Si hay progreso, verificar si completó
        if (progressData.progress === 100 || progressData.status === 'completed' || progressData.status === 'done') {
            if (progressData.url || progressData.downloadUrl) {
                return res.status(200).json({
                    status: 'success',
                    url: progressData.url || progressData.downloadUrl,
                    title: progressData.title || `video_${videoId}`
                });
            }
        }
        
        // Si hay error
        if (progressData.error || progressData.status === 'error' || progressData.status === 'failed') {
            throw new Error(progressData.error || 'Video conversion failed');
        }
    }
    
    throw new Error('Timeout waiting for video');
}

// Descargar AUDIO con youtube-video-fast-downloader API
async function downloadAudio(videoId, res) {
    // PASO 1: Obtener calidades disponibles
    const qualityRes = await fetch(`https://${MP3_API_HOST}/get_available_quality/${videoId}`, {
        headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': MP3_API_HOST
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
    const downloadEndpoint = `https://${MP3_API_HOST}/download_audio/${videoId}?quality=${selectedQuality.id}`;
    
    const downloadRes = await fetch(downloadEndpoint, {
        headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': MP3_API_HOST
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
}

// Polling para esperar que el archivo este disponible
async function waitForFile(fileUrl) {
    console.log('Waiting for file:', fileUrl);
    
    for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 5000));
        
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
    
    return fileUrl;
}
