import { json } from '@sveltejs/kit';
import { Maps_API_KEY } from '$env/static/private';

export async function GET({ url }) {
    const input = url.searchParams.get('input');
    const lat = url.searchParams.get('lat');
    const lon = url.searchParams.get('lon');

    if (!input) {
        return json({ error: 'Missing input parameter' }, { status: 400 });
    }

    const googleUrl = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    googleUrl.searchParams.set('input', input);
    googleUrl.searchParams.set('language', 'ja');
    googleUrl.searchParams.set('components', 'country:jp');
    googleUrl.searchParams.set('key', Maps_API_KEY);
    
    if (lat && lon && lat !== 'null' && lon !== 'null') {
        googleUrl.searchParams.set('location', `${lat},${lon}`);
        googleUrl.searchParams.set('radius', '10000');
    }

    try {
        const response = await fetch(googleUrl.toString());
        const data = await response.json();
        return json(data);
    } catch (error) {
        console.error('Autocomplete Proxy Error:', error);
        return json({ error: 'Failed to fetch from Google' }, { status: 500 });
    }
}
