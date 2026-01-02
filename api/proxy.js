// api/proxy.js - Vercel Serverless Function con Y2mate API
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

    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    ];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    try {
        // Paso 1: Analizar el video con Y2mate
        console.log('Analyzing video:', videoId);
        
        const analyzeResponse = await fetch('https://www.y2mate.com/mates/analyzeV2/ajax', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': randomUA,
                'Origin': 'https://www.y2mate.com',
                'Referer': 'https://www.y2mate.com/'
            },
            body: `k_query=https://www.youtube.com/watch?v=${videoId}&k_page=home&hl=en&q_auto=0`
        });

        if (!analyzeResponse.ok) {
            throw new Error(`Analyze failed: HTTP ${analyzeResponse.status}`);
        }

        const analyzeData = await analyzeResponse.json();
        console.log('Analyze response status:', analyzeData.status);

        if (analyzeData.status !== 'ok') {
            throw new Error(analyzeData.mess || 'Video analysis failed');
        }

        // Obtener el key del video y las opciones de formato
        const vid = analyzeData.vid;
        const isAudio = downloadMode === 'audio';
        
        let formatKey = null;
        let formatSize = '';
        
        if (isAudio) {
            // Buscar formato MP3
            const mp3Formats = analyzeData.links?.mp3;
            if (mp3Formats) {
                // Obtener la mejor calidad de MP3
                const keys = Object.keys(mp3Formats);
                if (keys.length > 0) {
                    formatKey = mp3Formats[keys[0]].k;
                    formatSize = mp3Formats[keys[0]].size;
                }
            }
        } else {
            // Buscar formato MP4 720p o el mejor disponible
            const mp4Formats = analyzeData.links?.mp4;
            if (mp4Formats) {
                // Prioridad: 720p > 480p > 360p
                const priorities = ['720p', '480p', '360p', '1080p'];
                for (const quality of priorities) {
                    if (mp4Formats[quality]) {
                        formatKey = mp4Formats[quality].k;
                        formatSize = mp4Formats[quality].size;
                        break;
                    }
                }
                // Si no encontró ninguno, usar el primero disponible
                if (!formatKey) {
                    const keys = Object.keys(mp4Formats);
                    if (keys.length > 0) {
                        formatKey = mp4Formats[keys[0]].k;
                        formatSize = mp4Formats[keys[0]].size;
                    }
                }
            }
        }

        if (!formatKey) {
            throw new Error('No suitable format found for this video');
        }

        console.log('Converting with key:', formatKey);

        // Paso 2: Obtener el link de descarga
        const convertResponse = await fetch('https://www.y2mate.com/mates/convertV2/index', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': randomUA,
                'Origin': 'https://www.y2mate.com',
                'Referer': 'https://www.y2mate.com/'
            },
            body: `vid=${vid}&k=${encodeURIComponent(formatKey)}`
        });

        if (!convertResponse.ok) {
            throw new Error(`Convert failed: HTTP ${convertResponse.status}`);
        }

        const convertData = await convertResponse.json();
        console.log('Convert response status:', convertData.status);

        if (convertData.status !== 'ok') {
            throw new Error(convertData.mess || 'Conversion failed');
        }

        if (!convertData.dlink) {
            throw new Error('No download link received');
        }

        // Devolver en formato compatible con el frontend
        return res.status(200).json({
            status: 'success',
            url: convertData.dlink,
            title: analyzeData.title || 'video',
            size: formatSize
        });

    } catch (err) {
        console.error('Error:', err.message);
        return res.status(503).json({
            status: 'error',
            text: err.message
        });
    }
}
