// api/proxy.js - Vercel Serverless Function con SaveFrom/Y2mate alternativo
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

    // Extraer video ID de la URL
    const videoIdMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!videoIdMatch) {
        return res.status(400).json({ status: 'error', text: 'Invalid YouTube URL' });
    }
    const videoId = videoIdMatch[1];
    const isAudio = downloadMode === 'audio';

    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

    // Intentar multiples APIs
    const apis = [
        tryY2mateIs,
        trySsyoutube,
        tryYtDownloader
    ];

    for (const apiFunc of apis) {
        try {
            const result = await apiFunc(videoId, isAudio, userAgent);
            if (result && result.url) {
                return res.status(200).json(result);
            }
        } catch (err) {
            console.log(`API failed: ${err.message}`);
        }
    }

    return res.status(503).json({
        status: 'error',
        text: 'All download services are currently unavailable. Please try again later.'
    });
}

// API 1: y2mate.is (alternativo)
async function tryY2mateIs(videoId, isAudio, userAgent) {
    console.log('Trying y2mate.is...');
    
    // Paso 1: Analizar
    const analyzeRes = await fetch('https://www.y2mate.is/mates/analyzeV2/ajax', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': userAgent,
            'Origin': 'https://www.y2mate.is',
            'Referer': 'https://www.y2mate.is/'
        },
        body: `k_query=https://www.youtube.com/watch?v=${videoId}&k_page=home&hl=en&q_auto=0`
    });

    if (!analyzeRes.ok) throw new Error(`HTTP ${analyzeRes.status}`);
    
    const data = await analyzeRes.json();
    if (data.status !== 'ok') throw new Error(data.mess || 'Analysis failed');

    // Buscar formato
    const formats = isAudio ? data.links?.mp3 : data.links?.mp4;
    if (!formats || Object.keys(formats).length === 0) {
        throw new Error('No formats available');
    }

    // Obtener el mejor formato
    let formatKey, quality;
    if (isAudio) {
        const keys = Object.keys(formats);
        formatKey = formats[keys[0]].k;
        quality = keys[0];
    } else {
        const priorities = ['720p', '480p', '360p', '1080p'];
        for (const q of priorities) {
            if (formats[q]) {
                formatKey = formats[q].k;
                quality = q;
                break;
            }
        }
        if (!formatKey) {
            const keys = Object.keys(formats);
            formatKey = formats[keys[0]].k;
            quality = keys[0];
        }
    }

    // Paso 2: Convertir
    const convertRes = await fetch('https://www.y2mate.is/mates/convertV2/index', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': userAgent,
            'Origin': 'https://www.y2mate.is',
            'Referer': 'https://www.y2mate.is/'
        },
        body: `vid=${data.vid}&k=${encodeURIComponent(formatKey)}`
    });

    if (!convertRes.ok) throw new Error(`Convert HTTP ${convertRes.status}`);
    
    const convertData = await convertRes.json();
    if (convertData.status !== 'ok' || !convertData.dlink) {
        throw new Error('Conversion failed');
    }

    return {
        status: 'success',
        url: convertData.dlink,
        title: data.title || 'video',
        quality: quality
    };
}

// API 2: ssyoutube.com
async function trySsyoutube(videoId, isAudio, userAgent) {
    console.log('Trying ssyoutube...');
    
    const response = await fetch(`https://api.ssyoutube.com/api/v1/?url=https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
            'User-Agent': userAgent
        }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    if (!data.formats || data.formats.length === 0) {
        throw new Error('No formats');
    }

    // Buscar el formato adecuado
    let downloadUrl;
    if (isAudio) {
        const audio = data.formats.find(f => f.mimeType?.includes('audio'));
        downloadUrl = audio?.url;
    } else {
        const video = data.formats.find(f => f.quality === '720p' || f.quality === '480p' || f.quality === '360p');
        downloadUrl = video?.url || data.formats[0]?.url;
    }

    if (!downloadUrl) throw new Error('No download URL');

    return {
        status: 'success',
        url: downloadUrl,
        title: data.title || 'video'
    };
}

// API 3: yt-download.org style
async function tryYtDownloader(videoId, isAudio, userAgent) {
    console.log('Trying yt-downloader...');
    
    const format = isAudio ? 'mp3' : 'mp4';
    const response = await fetch('https://api.vevioz.com/api/button/' + format, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': userAgent
        },
        body: `url=https://www.youtube.com/watch?v=${videoId}`
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    
    // Extraer URL del HTML
    const urlMatch = html.match(/href="(https:\/\/[^"]+\.(?:mp4|mp3|webm)[^"]*)"/i);
    if (!urlMatch) throw new Error('No download link found');

    return {
        status: 'success',
        url: urlMatch[1],
        title: 'video'
    };
}
