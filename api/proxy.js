// api/proxy.js - Vercel Serverless - YouTube to MP3/MP4
const RAPIDAPI_KEY = '0992c616bamsh5e52d07ff445561p12b1c0jsnd31fd982e16f';
const API_HOST = 'youtube-mp41.p.rapidapi.com';

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
        
        // Usar youtube-mp41 API para ambos
        // format=mp4 para video, format=mp3 para audio
        const format = isVideo ? 'mp4' : 'mp3';
        const quality = isVideo ? '720' : '128';
        
        // PASO 1: Iniciar descarga
        const downloadUrl = `https://${API_HOST}/api/v1/download?id=${videoId}&format=${format}&quality=${quality}`;
        console.log('Download URL:', downloadUrl);
        
        const downloadRes = await fetch(downloadUrl, {
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': API_HOST
            }
        });
        
        if (!downloadRes.ok) {
            const errText = await downloadRes.text();
            throw new Error(`API error ${downloadRes.status}: ${errText}`);
        }
        
        const downloadData = await downloadRes.json();
        console.log('Download response:', JSON.stringify(downloadData));
        
        // Si ya tiene URL de descarga directa
        if (downloadData.url || downloadData.downloadUrl || downloadData.link) {
            return res.status(200).json({
                status: 'success',
                url: downloadData.url || downloadData.downloadUrl || downloadData.link,
                title: downloadData.title || `${format}_${videoId}`
            });
        }
        
        // Si tiene ID, hacer polling con /progress
        const taskId = downloadData.id || downloadData.taskId || videoId;
        console.log('Task ID for polling:', taskId);
        
        // PASO 2: Polling para esperar resultado
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            
            const progressUrl = `https://${API_HOST}/api/v1/progress?id=${taskId}`;
            const progressRes = await fetch(progressUrl, {
                headers: {
                    'X-RapidAPI-Key': RAPIDAPI_KEY,
                    'X-RapidAPI-Host': API_HOST
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
                    title: progressData.title || `${format}_${videoId}`
                });
            }
            
            // Si hay progreso, verificar si completó
            if (progressData.progress === 100 || progressData.status === 'completed' || progressData.status === 'done') {
                if (progressData.url || progressData.downloadUrl) {
                    return res.status(200).json({
                        status: 'success',
                        url: progressData.url || progressData.downloadUrl,
                        title: progressData.title || `${format}_${videoId}`
                    });
                }
            }
            
            // Si hay error
            if (progressData.error || progressData.status === 'error' || progressData.status === 'failed') {
                throw new Error(progressData.error || 'Conversion failed');
            }
        }
        
        throw new Error('Timeout waiting for conversion');

    } catch (err) {
        console.error('Error:', err.message);
        return res.status(503).json({
            status: 'error',
            text: err.message
        });
    }
}
