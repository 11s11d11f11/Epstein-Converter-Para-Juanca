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

    const { url, downloadMode, quality, action, taskId } = req.body;

    try {
        // Si es una peticion de progreso
        if (action === 'progress' && taskId) {
            return await checkProgress(taskId, res);
        }

        if (!url) {
            return res.status(400).json({ status: 'error', text: 'No URL provided' });
        }

        const isVideo = downloadMode === 'video';
        
        // Extraer video ID
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
        if (!match) {
            throw new Error('Invalid YouTube URL');
        }
        const videoId = match[1];
        
        console.log('Video ID:', videoId, 'Mode:', isVideo ? 'MP4' : 'MP3', 'Quality:', quality);
        
        if (isVideo) {
            return await startMP4Download(videoId, quality || '720', res);
        } else {
            return await downloadMP3(videoId, res);
        }

    } catch (err) {
        console.error('Error:', err.message);
        return res.status(503).json({
            status: 'error',
            text: err.message
        });
    }
}

// Iniciar descarga MP4 - devuelve rapido sin polling
async function startMP4Download(videoId, quality, res) {
    const downloadUrl = `https://${MP4_API_HOST}/api/v1/download?id=${videoId}&format=${quality}&audioQuality=128&addInfo=false`;
    console.log('MP4 Download URL:', downloadUrl);
    
    const downloadRes = await fetch(downloadUrl, {
        headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': MP4_API_HOST
        }
    });
    
    if (!downloadRes.ok) {
        const errText = await downloadRes.text();
        throw new Error(`API error ${downloadRes.status}: ${errText}`);
    }
    
    const data = await downloadRes.json();
    console.log('MP4 response:', JSON.stringify(data));
    
    // Si ya tiene URL directa
    if (data.url || data.downloadUrl || data.link || data.file) {
        return res.status(200).json({
            status: 'success',
            url: data.url || data.downloadUrl || data.link || data.file,
            title: data.title || `video_${videoId}`
        });
    }
    
    // Devolver progressId para polling desde frontend
    const taskIdResult = data.progressId || data.id || data.taskId || data.jobId;
    if (taskIdResult) {
        return res.status(200).json({
            status: 'processing',
            taskId: taskIdResult,
            title: data.title || `video_${videoId}`,
            message: 'Video is being processed'
        });
    }
    
    throw new Error('No download URL or task ID received');
}

// Verificar progreso de tarea - llamado por frontend
async function checkProgress(taskId, res) {
    console.log('Checking progress for:', taskId);
    
    const progressRes = await fetch(`https://${MP4_API_HOST}/api/v1/progress?id=${taskId}`, {
        headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': MP4_API_HOST
        }
    });
    
    if (!progressRes.ok) {
        return res.status(200).json({
            status: 'processing',
            progress: 0,
            message: 'Still processing...'
        });
    }
    
    const data = await progressRes.json();
    console.log('Progress response:', JSON.stringify(data));
    
    // Si tiene URL lista (API devuelve downloadUrl)
    if (data.downloadUrl || data.url || data.link || data.file) {
        return res.status(200).json({
            status: 'success',
            url: data.downloadUrl || data.url || data.link || data.file,
            title: data.title || 'video'
        });
    }
    
    // Si finished es true pero no hay URL aun
    if (data.finished === true && data.status === 'Finished') {
        // Esperar, a veces tarda en generar URL
        return res.status(200).json({
            status: 'processing',
            progress: 100,
            message: 'Generating download link...'
        });
    }
    
    // Si hay error
    if (data.error || data.status === 'error' || data.status === 'failed') {
        return res.status(200).json({
            status: 'error',
            text: data.error || data.message || 'Conversion failed'
        });
    }
    
    // Aun procesando - progress viene en 0-1000
    const progressPercent = data.progress ? Math.round(data.progress / 10) : 0;
    return res.status(200).json({
        status: 'processing',
        progress: progressPercent,
        message: data.status || 'Processing...'
    });
}

// Descargar MP3 directamente
async function downloadMP3(videoId, res) {
    // Paso 1: Obtener calidades disponibles
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
    const audioQuality = qualities.find(q => q.type === 'audio');
    
    if (!audioQuality) {
        throw new Error('No audio quality available');
    }
    
    console.log('Audio quality:', audioQuality.id);
    
    // Paso 2: Obtener URL de descarga
    const downloadRes = await fetch(`https://${MP3_API_HOST}/download_audio/${videoId}?quality=${audioQuality.id}`, {
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
    console.log('MP3 response:', JSON.stringify(downloadData));
    
    if (!downloadData.file) {
        throw new Error('No file URL received');
    }
    
    // Devolver URL directamente
    return res.status(200).json({
        status: 'success',
        url: downloadData.file,
        title: `audio_${videoId}`
    });
}
