// Public page CSS. Colors come from the theme variables that render.js emits first:
// --bg --surface --text --muted --line --accent --on-accent --radius --font
export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100svh;background:var(--bg);color:var(--text);font-family:var(--font);font-size:1rem;line-height:1.45;-webkit-font-smoothing:antialiased}
body.bg-gradient{background:var(--bg);background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 16%,var(--bg)) 0,var(--bg) 70%) no-repeat fixed var(--bg)}
a{color:inherit}
.page{max-width:42rem;margin:0 auto;padding:calc(2.25rem + env(safe-area-inset-top)) 1rem calc(3.5rem + env(safe-area-inset-bottom))}
.profile{text-align:center;margin-bottom:1.75rem}
.avatar{display:block;width:6rem;height:6rem;margin:0 auto .9rem;border-radius:50%;object-fit:cover;background:var(--surface)}
h1{font-size:1.375rem;line-height:1.2;margin:0 0 .35rem;font-weight:700}
.bio{margin:0 auto;max-width:34rem;color:var(--muted);white-space:pre-line;overflow-wrap:anywhere}
nav{margin-top:1rem}
ul{list-style:none;margin:0;padding:0}
.icons{display:flex;flex-wrap:wrap;justify-content:center;gap:.25rem}
.icons a{display:flex;align-items:center;justify-content:center;width:2.5rem;height:2.5rem;border-radius:50%;color:var(--text);transition:background-color .15s,color .15s}
.icons a:hover{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.icons.inline{margin:.25rem 0 .75rem}
.ico{width:1.25rem;height:1.25rem;flex:none}
.ico-lg{width:1.5rem;height:1.5rem}
section{margin-top:1.75rem}
h2{font-size:.8125rem;letter-spacing:.06em;text-transform:uppercase;text-align:center;margin:0 0 .75rem;color:var(--muted);font-weight:700}
.links{display:grid;gap:.625rem}
.link{display:grid;grid-template-columns:3rem 1fr 3rem;align-items:center;gap:.5rem;min-height:3.5rem;padding:.5rem .75rem;text-decoration:none;text-align:center;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--text);font-weight:600;transition:transform .15s,border-color .15s,background-color .15s,box-shadow .15s;-webkit-tap-highlight-color:transparent}
.link:hover{border-color:var(--accent);transform:translateY(-1px)}
.link:active{transform:translateY(0) scale(.99)}
.link:focus-visible,.icons a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.lead{display:flex;align-items:center;justify-content:center;width:3rem;height:3rem}
.thumb{width:3rem;height:3rem;border-radius:calc(var(--radius) * .6);object-fit:cover;background:var(--line)}
.body{display:block;min-width:0;overflow-wrap:anywhere}
.title{display:block}
.desc{display:block;margin-top:.15rem;font-size:.875rem;font-weight:400;color:var(--muted)}
.has-desc{display:flex;gap:.75rem;padding-top:.75rem;padding-bottom:.75rem;text-align:left}
.has-desc .lead:empty{display:none}
.has-desc .lead{flex:none}
.has-desc .body{flex:1;text-align:left}
.card{display:block;padding:0;overflow:hidden;text-align:left}
.card-img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:var(--line)}
.card .body{padding:.875rem 1rem 1rem}
.card .title{font-size:1.0625rem}
.footnote{margin:.75rem 0 0;text-align:center;font-size:.8125rem;color:var(--muted)}
.btn-outline .link{background:transparent;border:2px solid var(--accent)}
.btn-soft .link{background:color-mix(in srgb,var(--accent) 14%,var(--surface));border-color:transparent}
.btn-soft .link:hover,.btn-outline .link:hover{border-color:var(--accent)}
@media (prefers-reduced-motion:reduce){.link,.icons a{transition:none}.link:hover,.link:active{transform:none}}
@media (min-width:40rem){.page{padding-top:3.5rem}h1{font-size:1.5rem}}
`;
