// api/proxy.js - Vercel Serverless con APIs funcionando
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

    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    let lastError = '';

    // Intentar múltiples servicios
    try {
        const result = await tryY2mateGuru(videoId, isAudio, userAgent);
        if (result && result.url) {
            return res.status(200).json(result);
        }
    } catch (err) {
        console.log('y2mate.guru failed:', err.message);
        lastError = err.message;
    }

    try {
        const result = await tryMp3Download(videoId, isAudio, userAgent);
        if (result && result.url) {
            return res.status(200).json(result);
        }
    } catch (err) {
        console.log('mp3download failed:', err.message);
        lastError = err.message;
    }

    try {
        const result = await tryYtMp3(videoId, isAudio, userAgent);
        if (result && result.url) {
            return res.status(200).json(result);
        }
    } catch (err) {
        console.log('ytmp3 failed:', err.message);
        lastError = err.message;
    }

    return res.status(503).json({
        status: 'error',
        text: 'Services unavailable: ' + lastError
    });
}

// Y2mate.guru API
async function tryY2mateGuru(videoId, isAudio, userAgent) {
    console.log('Trying y2mate.guru...');
    
    const format = isAudio ? 'mp3' : 'mp4';
    
    // Paso 1: Analizar
    const res1 = await fetch('https://www.y2mate.guru/api/convert', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': userAgent
        },
        body: JSON.stringify({
            url: `https://www.youtube.com/watch?v=${videoId}`,
            format: format
        })
    });

    if (!res1.ok) throw new Error(`HTTP ${res1.status}`);
    
    const data = await res1.json();
    
    if (data.status === 'error') throw new Error(data.message || 'Conversion failed');
    
    if (data.url || data.downloadUrl) {
        return {
            status: 'success',
            url: data.url || data.downloadUrl,
            title: data.title || 'video'
        };
    }
    
    throw new Error('No URL in response');
}

// MP3Download API
async function tryMp3Download(videoId, isAudio, userAgent) {
    console.log('Trying mp3download...');
    
    const response = await fetch(`https://api.mp3download.to/v1/youtube/${videoId}`, {
        headers: { 'User-Agent': userAgent }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    if (data.error) throw new Error(data.error);
    
    let downloadUrl = isAudio ? data.audio : data.video;
    if (!downloadUrl && data.formats) {
        const format = data.formats.find(f => isAudio ? f.type === 'audio' : f.type === 'video');
        downloadUrl = format?.url;
    }
    
    if (!downloadUrl) throw new Error('No format found');
    
    return {
        status: 'success',
        url: downloadUrl,
        title: data.title || 'video'
    };
}

// YTMP3 API simple
async function tryYtMp3(videoId, isAudio, userAgent) {
    console.log('Trying ytmp3...');
    
    // Usar una API pública de conversión
    const format = isAudio ? 'mp3' : '360'; // 360p para video
    const apiUrl = `https://yt1s.io/api/ajaxSearch/index`;
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': userAgent,
            'Origin': 'https://yt1s.io',
            'Referer': 'https://yt1s.io/'
        },
        body: `q=https://www.youtube.com/watch?v=${videoId}&vt=mp3`
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    if (data.status !== 'ok') throw new Error(data.mess || 'Failed');
    
    // Obtener el link de conversión
    const vid = data.vid;
    const links = isAudio ? data.links?.mp3 : data.links?.mp4;
    
    if (!links || Object.keys(links).length === 0) {
        throw new Error('No links available');
    }
    
    // Obtener el primer formato disponible
    const firstKey = Object.keys(links)[0];
    const formatData = links[firstKey];
    
    // Paso 2: Obtener link de descarga
    const convertRes = await fetch('https://yt1s.io/api/ajaxConvert/convert', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': userAgent,
            'Origin': 'https://yt1s.io',
            'Referer': 'https://yt1s.io/'
        },
        body: `vid=${vid}&k=${encodeURIComponent(formatData.k)}`
    });

    if (!convertRes.ok) throw new Error(`Convert HTTP ${convertRes.status}`);
    
    const convertData = await convertRes.json();
    
    if (convertData.status !== 'ok' || !convertData.dlink) {
        throw new Error('Conversion failed');
    }

    return {
        status: 'success',
        url: convertData.dlink,
        title: data.title || 'video'
    };
}
