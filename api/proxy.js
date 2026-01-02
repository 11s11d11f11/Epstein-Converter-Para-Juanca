// api/proxy.js - Vercel Serverless - YouTube to MP3/MP4
const RAPIDAPI_KEY = '0992c616bamsh5e52d07ff445561p12b1c0jsnd31fd982e16f';

// APIs
const MP3_API_HOST = 'youtube-mp36.p.rapidapi.com';
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

    const { url, downloadMode, quality, action, taskId, taskType } = req.body;

    try {
        // Si es una peticion de progreso
        if (action === 'progress' && taskId) {
            return await checkProgress(taskId, taskType, res);
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
async function checkProgress(taskId, taskType, res) {
    console.log('Checking progress for:', taskId, 'type:', taskType);
    
    // Si es MP3, usar la API de MP3
    if (taskType === 'mp3') {
        const response = await fetch(`https://${MP3_API_HOST}/dl?id=${taskId}`, {
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': MP3_API_HOST
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'ok' && data.link) {
            return res.status(200).json({
                status: 'success',
                url: data.link,
                title: data.title || 'audio'
            });
        }
        
        if (data.status === 'fail') {
            return res.status(200).json({
                status: 'error',
                text: data.msg || 'MP3 conversion failed'
            });
        }
        
        return res.status(200).json({
            status: 'processing',
            progress: data.progress || 0,
            message: 'Converting audio...'
        });
    }
    
    // MP4 - usar API de MP4
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

// Descargar MP3 - API rapida youtube-mp36
async function downloadMP3(videoId, res) {
    const apiUrl = `https://${MP3_API_HOST}/dl?id=${videoId}`;
    console.log('MP3 API URL:', apiUrl);
    
    const response = await fetch(apiUrl, {
        headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': MP3_API_HOST
        }
    });
    
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`MP3 API error ${response.status}: ${errText}`);
    }
    
    const data = await response.json();
    console.log('MP3 response:', JSON.stringify(data));
    
    // Si status es "ok" y tiene link
    if (data.status === 'ok' && data.link) {
        return res.status(200).json({
            status: 'success',
            url: data.link,
            title: data.title || `audio_${videoId}`
        });
    }
    
    // Si status es "processing", devolver para polling
    if (data.status === 'processing') {
        return res.status(200).json({
            status: 'processing',
            taskId: videoId,
            taskType: 'mp3',
            message: 'Converting audio...'
        });
    }
    
    // Si fallo
    if (data.status === 'fail') {
        throw new Error(data.msg || 'MP3 conversion failed');
    }
    
    throw new Error('No MP3 link received');
}
