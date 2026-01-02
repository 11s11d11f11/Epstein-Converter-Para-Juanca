// api/proxy.js - Vercel Serverless - YouTube to MP3/MP4
const RAPIDAPI_KEY = '0992c616bamsh5e52d07ff445561p12b1c0jsnd31fd982e16f';

// APIs separadas
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
            return await downloadMP4(videoId, res);
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

// MP4 con youtube-mp41 API
async function downloadMP4(videoId, res) {
    // Usar 360p para soportar videos mas largos (limite 50MB en free tier)
    const downloadUrl = `https://${MP4_API_HOST}/api/v1/download?id=${videoId}&format=360&audioQuality=128&addInfo=false`;
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
    console.log('MP4 response:', JSON.stringify(downloadData));
    
    // Buscar URL en cualquier propiedad
    const findUrl = (obj) => {
        if (!obj) return null;
        if (obj.url) return obj.url;
        if (obj.downloadUrl) return obj.downloadUrl;
        if (obj.link) return obj.link;
        if (obj.file) return obj.file;
        return null;
    };
    
    let fileUrl = findUrl(downloadData);
    if (fileUrl) {
        return res.status(200).json({
            status: 'success',
            url: fileUrl,
            title: downloadData.title || `video_${videoId}`
        });
    }
    
    // La API devuelve un ID para polling
    const taskId = downloadData.id || downloadData.taskId || downloadData.jobId || videoId;
    console.log('Task ID:', taskId);
    
    // Polling con /progress - max 20 intentos (40 segundos)
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 2000));
        
        try {
            const progressRes = await fetch(`https://${MP4_API_HOST}/api/v1/progress?id=${taskId}`, {
                headers: {
                    'X-RapidAPI-Key': RAPIDAPI_KEY,
                    'X-RapidAPI-Host': MP4_API_HOST
                }
            });
            
            const progressText = await progressRes.text();
            console.log('Progress raw:', progressText);
            
            if (!progressRes.ok) continue;
            
            const progressData = JSON.parse(progressText);
            
            // Buscar URL
            fileUrl = findUrl(progressData);
            if (fileUrl) {
                return res.status(200).json({
                    status: 'success',
                    url: fileUrl,
                    title: progressData.title || `video_${videoId}`
                });
            }
            
            // Verificar progreso
            if (progressData.progress !== undefined) {
                console.log('Progress %:', progressData.progress);
                if (progressData.progress === 100) {
                    // Esperar un poco más y buscar URL
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
            }
            
            // Verificar estado
            if (progressData.status === 'completed' || progressData.status === 'done' || progressData.status === 'finished') {
                fileUrl = findUrl(progressData);
                if (fileUrl) {
                    return res.status(200).json({
                        status: 'success',
                        url: fileUrl,
                        title: progressData.title || `video_${videoId}`
                    });
                }
            }
            
            if (progressData.error || progressData.status === 'error' || progressData.status === 'failed') {
                throw new Error(progressData.error || progressData.message || 'Conversion failed');
            }
        } catch (e) {
            if (e.message.includes('Conversion failed')) throw e;
            console.log('Progress check error:', e.message);
        }
    }
    
    throw new Error('Timeout - video may be too long or unavailable');
}

// MP3 con youtube-video-fast-downloader API
async function downloadMP3(videoId, res) {
    // Paso 1: Obtener calidades
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
        throw new Error('No audio quality found');
    }
    
    console.log('Audio quality:', audioQuality.id);
    
    // Paso 2: Descargar audio
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
        throw new Error('No file URL');
    }
    
    // Paso 3: Esperar que el archivo esté listo
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        
        try {
            const check = await fetch(downloadData.file, { method: 'HEAD' });
            if (check.ok) {
                return res.status(200).json({
                    status: 'success',
                    url: downloadData.file,
                    title: `audio_${videoId}`
                });
            }
        } catch (e) {
            console.log('File not ready yet');
        }
    }
    
    // Devolver URL de todas formas
    return res.status(200).json({
        status: 'success',
        url: downloadData.file,
        title: `audio_${videoId}`
    });
}
