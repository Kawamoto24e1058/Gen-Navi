
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/api" | "/api/ai" | "/api/ai/assess-hazards" | "/api/ai/assess-route" | "/api/route" | "/api/search" | "/api/voice";
		RouteParams(): {
			
		};
		LayoutParams(): {
			"/": Record<string, never>;
			"/api": Record<string, never>;
			"/api/ai": Record<string, never>;
			"/api/ai/assess-hazards": Record<string, never>;
			"/api/ai/assess-route": Record<string, never>;
			"/api/route": Record<string, never>;
			"/api/search": Record<string, never>;
			"/api/voice": Record<string, never>
		};
		Pathname(): "/" | "/api/ai/assess-hazards" | "/api/ai/assess-route" | "/api/route" | "/api/search" | "/api/voice";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/manifest.json" | "/pwa-icon.png" | string & {};
	}
}