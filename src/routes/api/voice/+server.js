import { error } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const text = url.searchParams.get('text');
    if (!text) throw error(400, 'Text is required');

    // speaker 3 (Zundamon Normal)
    const speaker = 3;
    
    try {
        const encodedText = encodeURIComponent(text);
        // Added speaker=3 for Zundamon as requested
        const synthesisUrl = `https://api.tts.quest/v3/voicevox/synthesis?text=${encodedText}&speaker=${speaker}`;
        
        console.log(`[Voice API] Requesting: ${text.substring(0, 20)}...`);
        const res = await fetch(synthesisUrl);
        
        if (!res.ok) {
            const errorBody = await res.text();
            console.error(`[Voice API] TTS Quest Initial Request Failed: ${res.status}`, errorBody);
            throw new Error(`TTS Quest API returned status ${res.status}`);
        }

        const result = await res.json();
        console.log(`[Voice API] API Response:`, result);
        
        if (result.success && result.wavDownloadUrl) {
            let audioData = null;
            const maxAttempts = 30; // Increased polling
            
            for (let i = 0; i < maxAttempts; i++) {
                console.log(`[Voice API] Polling audio (Attempt ${i + 1}/${maxAttempts})...`);
                try {
                    const audioRes = await fetch(result.wavDownloadUrl);
                    
                    if (audioRes.ok) {
                        audioData = await audioRes.arrayBuffer();
                        console.log(`[Voice API] Audio retrieved! Size: ${audioData.byteLength} bytes`);
                        break;
                    }
                    
                    if (audioRes.status === 404) {
                        await new Promise(r => setTimeout(r, 1000)); // Wait 1s
                        continue;
                    }
                    
                    console.error(`[Voice API] Audio download error: ${audioRes.status}`);
                    break;
                } catch (e) {
                    console.warn(`[Voice API] Polling fetch error:`, e.message);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (audioData && audioData.byteLength > 0) {
                return new Response(audioData, {
                    headers: {
                        'Content-Type': 'audio/wav',
                        'Content-Length': audioData.byteLength.toString(),
                        'Cache-Control': 'public, max-age=3600'
                    }
                });
            } else {
                throw new Error('Audio generation timed out or returned empty data.');
            }
        } else if (result.retry) {
            console.warn(`[Voice API] API Busy, retry in ${result.retry}s`);
            throw new Error(`API Busy (Retry in ${result.retry}s)`);
        } else {
            console.error(`[Voice API] API returned failure:`, result);
            throw new Error(result.error || 'TTS Quest API failed to provide download URL');
        }
    } catch (err) {
        console.error('[Voice API] Final Catch Error:', err.message);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
