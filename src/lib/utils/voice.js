import { browser } from '$app/environment';

let currentAudio = null;
const audioCache = new Map();
let isProcessingQueue = false;
const voiceQueue = [];
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between synthesis requests to prevent 429

/**
 * Pre-fetches voice data for a given text and stores it in cache as a Blob URL.
 */
export async function prefetchVoice(text) {
    if (!browser || !text || audioCache.has(text)) return;
    
    // For pre-fetch, we don't use the queue but we respect 429
    try {
        const response = await fetch(`/api/voice?text=${encodeURIComponent(text)}`);
        if (!response.ok) {
            const errorJson = await response.json().catch(() => ({}));
            if (response.status === 429) {
                console.warn('[VOICEVOX] Pre-fetch API制限のためスキップしました。');
            } else {
                console.warn('Zundamon Pre-fetch failed:', errorJson.error || response.status);
            }
            return;
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        audioCache.set(text, url);
    } catch (err) {
        console.warn('Zundamon Pre-fetch Error:', err.message);
    }
}

/**
 * Stops any currently playing audio.
 */
export function stopZundamon() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
}

/**
 * Process the voice queue sequentially
 */
async function processQueue() {
    if (isProcessingQueue || voiceQueue.length === 0) return;
    isProcessingQueue = true;

    while (voiceQueue.length > 0) {
        const { text, resolve, reject } = voiceQueue.shift();
        
        try {
            // Speed control: playbackRate = 1.5 in the browser
            // Ensure interval between requests
            const now = Date.now();
            const timeSinceLast = now - lastRequestTime;
            if (timeSinceLast < MIN_REQUEST_INTERVAL) {
                await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLast));
            }

            // Check cache again right before fetching
            let url = audioCache.get(text);
            
            if (!url) {
                console.log('[VOICEVOX] Synthesizing:', text.substring(0, 20) + '...');
                lastRequestTime = Date.now();
                const response = await fetch(`/api/voice?text=${encodeURIComponent(text)}`);
                
                if (response.status === 429 || response.status === 503) {
                    console.warn('[VOICEVOX] API制限のため再試行中...');
                    // Put back to front of queue and wait longer
                    voiceQueue.unshift({ text, resolve, reject });
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }

                if (!response.ok) {
                    const errorJson = await response.json().catch(() => ({}));
                    throw new Error(errorJson.error || 'Speech synthesis failed');
                }

                const blob = await response.blob();
                url = URL.createObjectURL(blob);
                audioCache.set(text, url);
            }

            // Playback
            stopZundamon();
            const audio = new Audio(url);
            currentAudio = audio;
            audio.playbackRate = 1.5; // Zundamon ultra-speed
            
            audio.onended = () => {
                currentAudio = null;
                resolve();
            };

            await audio.play();
        } catch (err) {
            console.warn('[VOICEVOX] Guidance Error:', err.message);
            resolve(); // Don't block the queue on single failure
        }
    }

    isProcessingQueue = false;
}

/**
 * Zundamon Voice Guidance with Queuing and 1.5x Speed.
 */
export async function playZundamon(text) {
    if (!browser || !text) return;

    // If it's in cache, we can play immediately and interrupt current
    const cachedUrl = audioCache.get(text);
    if (cachedUrl) {
        console.log('[VOICEVOX] Playing from cache (1.5x):', text.substring(0, 20));
        stopZundamon();
        const audio = new Audio(cachedUrl);
        currentAudio = audio;
        audio.playbackRate = 1.5;
        await audio.play();
        return;
    }

    // Otherwise, queue it up to handle throttle/synthesis
    return new Promise((resolve, reject) => {
        // Limit queue length to prevent stale guidance
        if (voiceQueue.length > 2) {
            console.log('[VOICEVOX] Queue too long, dropping old request.');
            const dropped = voiceQueue.shift();
            if (dropped) dropped.resolve();
        }
        
        voiceQueue.push({ text, resolve, reject });
        processQueue();
    });
}
