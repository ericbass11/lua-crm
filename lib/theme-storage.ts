// Persisted browser preference: changing this key would lose existing choices.
export const STORAGE_KEY = "deskcomm-theme";

// Server-safe script runs before React hydration using the provider's exact key.
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=(s==='dark'||s==='light')?s:((s==='system'||!s)&&d?'dark':'light');document.documentElement.setAttribute('data-theme',r);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
