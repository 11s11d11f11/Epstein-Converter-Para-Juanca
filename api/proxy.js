// api/proxy.js - Vercel Serverless con múltiples APIs
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

    // Extraer video ID
    const videoIdMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!videoIdMatch) {
        return res.status(400).json({ status: 'error', text: 'Invalid YouTube URL' });
    }
    const videoId = videoIdMatch[1];
    const isAudio = downloadMode === 'audio';

    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

    // Intentar múltiples servicios
    const services = [
        () => tryLoaderTo(videoId, isAudio, userAgent),
        () => trySaveFrom(videoId, isAudio, userAgent),
        () => tryYtDl(videoId, isAudio, userAgent)
    ];

    for (const service of services) {
        try {
            const result = await service();
            if (result && result.url) {
                return res.status(200).json(result);
            }
        } catch (err) {
            console.log(`Service failed: ${err.message}`);
        }
    }

    return res.status(503).json({
        status: 'error',
        text: 'All services unavailable. Try again later.'
    });
}

// Loader.to API
async function tryLoaderTo(videoId, isAudio, userAgent) {
    console.log('Trying loader.to...');
    
    const format = isAudio ? 'mp3' : 'mp4';
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Paso 1: Iniciar conversión
    const initRes = await fetch(`https://loader.to/ajax/download.php?format=${format}&url=${encodeURIComponent(ytUrl)}`, {
        headers: { 'User-Agent': userAgent }
    });
    
    if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
    
    const initData = await initRes.json();
    if (!initData.success || !initData.id) throw new Error('Init failed');
    
    const downloadId = initData.id;
    console.log('Loader.to ID:', downloadId);
    
    // Paso 2: Esperar a que termine (polling)
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        
        const progressRes = await fetch(`https://loader.to/ajax/progress.php?id=${downloadId}`, {
            headers: { 'User-Agent': userAgent }
        });
        
        if (!progressRes.ok) continue;
        
        const progress = await progressRes.json();
        console.log('Progress:', progress.progress, '%');
        
        if (progress.success === 1 && progress.download_url) {
            return {
                status: 'success',
                url: progress.download_url,
                title: progress.title || 'video'
            };
        }
        
        if (progress.success === 0 && progress.progress === 0) {
            throw new Error('Conversion failed');
        }
    }
    
    throw new Error('Timeout waiting for conversion');
}

// SaveFrom style API
async function trySaveFrom(videoId, isAudio, userAgent) {
    console.log('Trying savefrom...');
    
    const response = await fetch('https://worker.sf-tools.com/savefrom.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': userAgent,
            'Origin': 'https://savefrom.net',
            'Referer': 'https://savefrom.net/'
        },
        body: `sf_url=https://www.youtube.com/watch?v=${videoId}&sf_submit=&new=1&lang=en&app=&country=en&os=Windows&browser=Chrome&channel=main&sm=0`
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    if (!data || !data[0] || !data[0].url) {
        throw new Error('No data received');
    }

    const videoData = data[0];
    let downloadUrl;
    
    if (isAudio && videoData.audio) {
        downloadUrl = videoData.audio[0]?.url;
    } else if (videoData.url) {
        // Buscar calidad 720p o menor
        const formats = videoData.url;
        const preferred = formats.find(f => f.quality === '720p' || f.quality === '480p' || f.quality === '360p');
        downloadUrl = preferred?.url || formats[0]?.url;
    }

    if (!downloadUrl) throw new Error('No download URL');

    return {
        status: 'success',
        url: downloadUrl,
        title: videoData.meta?.title || 'video'
    };
}

// YT-DL API alternativo
async function tryYtDl(videoId, isAudio, userAgent) {
    console.log('Trying yt-dl...');
    
    const format = isAudio ? 'bestaudio' : 'best[height<=720]';
    
    const response = await fetch(`https://api.vevioz.com/@api/json/mp3/${videoId}`, {
        headers: { 'User-Agent': userAgent }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    if (!data.link) throw new Error('No link in response');

    return {
        status: 'success',
        url: data.link,
        title: data.title || 'video'
    };
}
