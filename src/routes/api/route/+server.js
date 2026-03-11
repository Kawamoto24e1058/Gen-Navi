import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const start = url.searchParams.get('start'); // lon,lat
    const end = url.searchParams.get('end'); // lon,lat
    
    if (!start || !end) {
        return json({ error: 'Missing start or end' }, { status: 400 });
    }

    try {
        // 1. Try OSRM with exclusion first
        let osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson&steps=true&exclude=tolls,motorway`;
        let response = await fetch(osrmUrl);
        let data = await response.json();

        // 2. Fallback if exclude is not supported or returns error
        if (data.code !== 'Ok') {
            osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson&steps=true`;
            response = await fetch(osrmUrl);
            data = await response.json();
        }

        if (data.code !== 'Ok' || data.routes.length === 0) {
            return json({ error: 'Route not found' }, { status: 404 });
        }

        const route = data.routes[0];
        return json({ route });
    } catch (e) {
        console.error('Route Proxy Error:', e);
        return json({ error: e.message }, { status: 500 });
    }
}
