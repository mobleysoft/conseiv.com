import { useEffect, useRef, useState } from 'react';
import ModelViewer from './ModelViewer.jsx';
import { DEFAULT_PARAMETERS, PARAMETER_LIMITS, generateBracket, exportOBJ, exportSTL } from '../../shared/geometry.js';

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data;
  try { data = await response.json(); } catch { throw new Error('The studio service did not return JSON. Please try again.'); }
  if (!response.ok) { const error = new Error(data.error?.message || 'Request failed.'); error.status = response.status; throw error; }
  return data;
}
const fmt = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fields = [
  ['legAWidth', 'Leg A', 'mm', 1], ['legBWidth', 'Leg B', 'mm', 1], ['flangeLength', 'Flange width', 'mm', 1],
  ['thickness', 'Sheet thickness', 'mm', 0.5], ['bendRadius', 'Inside radius', 'mm', 0.5], ['bendAngleDeg', 'Bend angle', 'deg', 1],
  ['holeDiameter', 'Hole diameter', 'mm', 0.5], ['holesPerLeg', 'Holes per leg', '', 1], ['edgeMargin', 'Hole margin', 'mm', 0.5], ['kFactor', 'K-factor', '', 0.01],
];
const presets = [
  { name: 'Mounting bracket', description: 'A versatile starting point', parameters: { ...DEFAULT_PARAMETERS } },
  { name: 'Compact support', description: 'A smaller, lighter profile', parameters: { ...DEFAULT_PARAMETERS, legAWidth: 45, legBWidth: 35, flangeLength: 25, thickness: 2, bendRadius: 3, holesPerLeg: 1, edgeMargin: 8, holeDiameter: 5 } },
  { name: 'Wide angle', description: 'Open up the geometry', parameters: { ...DEFAULT_PARAMETERS, legAWidth: 100, legBWidth: 80, flangeLength: 55, bendAngleDeg: 60, thickness: 4, bendRadius: 6, holesPerLeg: 3 } },
];

function AuthDialog({ onClose, onUser }) {
  const dialog = useRef(null);
  const [register, setRegister] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await api(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(data) }); onUser(result.user); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <dialog className="auth-dialog" ref={dialog} onCancel={onClose} aria-labelledby="auth-title">
    <button className="close-dialog" onClick={onClose} aria-label="Close sign in">x</button>
    <span className="eyebrow">YOUR PERSONAL DESIGN LIBRARY</span>
    <h2 id="auth-title">Keep your ideas<br />within reach.</h2>
    <p>Sign in with your AuthFor account to save and reopen your designs.</p>
    <form onSubmit={submit}>
      {register && <label>Name<input name="name" autoComplete="name" maxLength={100} required /></label>}
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
      <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={8} maxLength={256} required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Connecting...' : register ? 'Create account' : 'Sign in'}</button>
    </form>
    <button className="text-button" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
  </dialog>;
}

export default function App() {
  const [parameters, setParameters] = useState({ ...DEFAULT_PARAMETERS });
  const [generation, setGeneration] = useState(() => generateBracket(DEFAULT_PARAMETERS));
  const [name, setName] = useState('Mounting bracket'), [view, setView] = useState('bent');
  const [wireframe, setWireframe] = useState(false), [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [message, setMessage] = useState('Local preview. Generate to check the service.');
  const [user, setUser] = useState(null), [auth, setAuth] = useState(false);
  const [assets, setAssets] = useState([]), [library, setLibrary] = useState(false), [more, setMore] = useState(null);
  const [format, setFormat] = useState('stl');
  const dirty = JSON.stringify(parameters) !== JSON.stringify(generation.parameters);
  const mesh = generation.meshes[view];
  useEffect(() => {
    const controller = new AbortController();
    api('/api/auth/me', { signal: controller.signal }).then(data => setUser(data.user)).catch(() => {});
    return () => controller.abort();
  }, []);
  async function generate(next = parameters) {
    setBusy(true); setError('');
    try {
      const result = await api('/api/conseiv/cad-mesh-generation', { method: 'POST', body: JSON.stringify({ parameters: next }) });
      setGeneration(result); setMessage('Geometry generated. Ready to inspect or export.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function openLibrary(offset = 0) {
    if (!user) { setAuth(true); return; }
    setBusy(true); setError('');
    try {
      const result = await api(`/api/conseiv/assets?offset=${offset}&limit=20`);
      setAssets(previous => offset ? [...previous, ...result.assets] : result.assets);
      setMore(result.pagination.nextOffset); setLibrary(true);
    } catch (e) { setError(e.message); if (e.status === 401) { setUser(null); setAuth(true); } }
    finally { setBusy(false); }
  }
  async function save() {
    if (!user) { setAuth(true); return; }
    setBusy(true); setError('');
    try {
      const result = await api('/api/conseiv/assets', { method: 'POST', body: JSON.stringify({ name, parameters: generation.parameters }) });
      setMessage(`Saved ${result.asset.name} to your library.`);
    } catch (e) { setError(e.message); if (e.status === 401) { setUser(null); setAuth(true); } }
    finally { setBusy(false); }
  }
  async function loadAsset(asset) {
    setBusy(true); setError('');
    try {
      const result = await api(`/api/conseiv/assets/${asset.id}`);
      setGeneration(result.generation); setParameters(result.generation.parameters); setName(result.asset.name); setLibrary(false); setMessage('Saved design restored.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function download() {
    const text = format === 'obj' ? exportOBJ(mesh) : exportSTL(mesh);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = `${name.replace(/[^a-z0-9_-]/gi, '-').slice(0,80) || 'conseiv'}-${view}.${format}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`${format.toUpperCase()} exported in millimeters.`);
  }
  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); setUser(null); setLibrary(false); setMessage('Signed out. Your current model is still available.'); }
    catch (e) { setError(e.message); }
  }
  return <div className="studio-shell">
    <header className="topbar">
      <a href="/" className="brand" aria-label="Conseiv home"><span className="brand-mark"><i /><i /><i /></span>conseiv<span className="brand-divider" /><small>STUDIO</small></a>
      <div className="topbar-right"><span className="desktop-only subtle">BUILT WITH MOBLEYSOFT</span><button onClick={() => openLibrary()} disabled={busy}>My designs</button><button className="account-button" onClick={user ? signOut : () => setAuth(true)}>{user ? 'Sign out' : 'Sign in'}<span aria-hidden="true">{user ? user.name.slice(0,1).toUpperCase() : '+'}</span></button></div>
    </header>
    <main>
      <section className="workspace-heading"><div><span className="eyebrow">PARAMETRIC DESIGN / 01</span><h1>From intent to <span>form.</span></h1><p>Shape it. Inspect it. Make it yours.</p></div><div className="heading-note"><span className="status-dot" />Mounting bracket workspace<small>Real geometry. Every dimension in your hands.</small></div></section>
      <div className="workspace">
        <aside className="properties glass">
          <div className="panel-heading"><h2>Design parameters</h2><span className="small-tag">MM</span></div>
          <label className="preset-label">STARTING POINT<select aria-label="Starting point" defaultValue="0" disabled={busy} onChange={e => { const preset = presets[Number(e.target.value)]; setParameters({ ...preset.parameters }); setName(preset.name); }}>
            {presets.map((p,i) => <option key={p.name} value={i}>{p.name}</option>)}
          </select></label>
          <form onSubmit={e => { e.preventDefault(); generate(); }}>
            <fieldset disabled={busy}><legend className="sr-only">Bracket dimensions</legend>
              {fields.map(([key, label, unit, step], index) => <div key={key} className={`parameter ${index === 6 ? 'section-break' : ''}`}>
                <label htmlFor={key}>{label}</label><div className="number-field"><input id={key} type="number" step={step} min={PARAMETER_LIMITS[key].min} max={PARAMETER_LIMITS[key].max} value={parameters[key]} required onChange={e => setParameters(p => ({ ...p, [key]: e.target.value === '' ? '' : Number(e.target.value) }))} /><span>{unit}</span></div>
              </div>)}
            </fieldset>
            <button className="primary generate-button" disabled={busy}>{busy ? 'Working...' : 'Generate geometry'}<span aria-hidden="true">↗</span></button>
          </form>
          <p className="parameter-help">Outside leg dimensions. Hole margins are measured from each hole's center to the straight leg's edge.</p>
        </aside>
        <section className="model-panel glass" aria-label="Model workspace">
          <div className="model-toolbar"><div><span className="eyebrow">{name}</span><span className={`model-state ${dirty ? 'pending' : ''}`}>{dirty ? 'Unapplied changes' : 'Parametric model'}</span></div><div className="segmented" aria-label="Model view"><button aria-pressed={view === 'bent'} onClick={() => setView('bent')}>Formed</button><button aria-pressed={view === 'flat'} onClick={() => setView('flat')}>Flat pattern</button></div></div>
          <ModelViewer mesh={mesh} view={view} wireframe={wireframe} resetKey={resetKey} />
          <div className="model-overlay-label"><span className="corner-bracket">+</span><span>{view === 'bent' ? 'FORMED GEOMETRY' : 'DEVELOPED BLANK'}<small>{fmt(generation.parameters.legAWidth)} / {fmt(generation.parameters.legBWidth)} / {fmt(generation.parameters.thickness)} mm</small></span></div>
          <div className="viewer-bottom"><span>DRAG TO ORBIT <i /> SCROLL TO ZOOM</span><div><button aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}>Wireframe</button><button onClick={() => setResetKey(k => k + 1)}>Fit view</button></div></div>
        </section>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="workspace-status" role="status" aria-live="polite"><span className="status-dot" />{message}</div>
      <section className="output-row">
        <div className="measurements glass"><div><span>BEND ALLOWANCE</span><strong>{fmt(generation.metadata.bendAllowance)}<small>mm</small></strong></div><div><span>FLAT LENGTH</span><strong>{fmt(generation.metadata.totalFlatLength)}<small>mm</small></strong></div><div><span>THROUGH HOLES</span><strong>{generation.metadata.holeCount}<small>total</small></strong></div><div><span>MESH FACES</span><strong>{mesh.triangleCount.toLocaleString()}<small>triangles</small></strong></div></div>
        <div className="export-panel glass"><label className="sr-only" htmlFor="export-format">Export format</label><select id="export-format" value={format} onChange={e => setFormat(e.target.value)}><option value="stl">STL</option><option value="obj">OBJ</option></select><button onClick={download}>Export {view === 'flat' ? 'flat' : '3D'} model <span aria-hidden="true">↓</span></button></div>
      </section>
      <section className="save-row"><label>Design name<input aria-label="Design name" value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label><button disabled={busy || dirty || !name.trim()} onClick={save}>Save to library <span aria-hidden="true">+</span></button><p>Parametric mesh preview. Confirm material, tooling, tolerances, and bend compensation before fabrication.</p></section>
      {library && <section className="library glass" aria-label="Saved designs"><div className="panel-heading"><h2>Your designs</h2><button onClick={() => setLibrary(false)}>Close library</button></div>{!assets.length && <p>No saved designs yet. Save the current model to start your collection.</p>}<div className="library-grid">{assets.map(asset => <button disabled={busy} onClick={() => loadAsset(asset)} key={asset.id}><span className="library-shape" aria-hidden="true">⌑</span><strong>{asset.name}</strong><small>{new Date(asset.createdAt).toLocaleDateString()}</small><span>Open design ↗</span></button>)}</div>{more !== null && <button disabled={busy} onClick={() => openLibrary(more)}>Load more designs</button>}</section>}
    </main>
    <footer><a href="https://mobleysoft.com">MOBLEYSOFT</a><span>TOOLS FOR MAKING WHAT COMES NEXT.</span><span>CONSEIV / PARAMETRIC STUDIO</span></footer>
    {auth && <AuthDialog onClose={() => setAuth(false)} onUser={nextUser => { setUser(nextUser); setAuth(false); setMessage(`Signed in as ${nextUser.name}. You can now save your design.`); }} />}
  </div>;
}
