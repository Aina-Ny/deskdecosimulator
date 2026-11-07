import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, STYLES, categoryLabel } from '../shared/categories';
import type { AppConfig, CategoryId, EngineId, InlineImage, Product } from '../shared/types';
import { Admin } from './components/Admin';
import { Compare } from './components/Compare';
import { MaskEditor } from './components/MaskEditor';
import { Panorama } from './components/Panorama';
import { api, ApiError, setAppPassword } from './lib/api';
import {
  compositeProtected,
  compressImage,
  dataUrlToInline,
  downscaleInline,
  downloadCanvas,
  inlineToDataUrl,
  loadImage,
  maskHasPaint,
  prepareSource,
  withLegend,
  type PreparedSource,
} from './lib/image';
import { buildPanoramaPrompt, buildPrompt, emptyCriteria, pickProducts, type Criteria } from './lib/prompt';

interface Generation {
  id: string;
  canvas: HTMLCanvasElement;
  url: string;
  products: Product[];
  engine: EngineId;
  model: string;
  at: Date;
  panorama?: { url: string; width: number; height: number; inline: InlineImage };
}

const euro = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const MAX_INSPIRATIONS = 3;

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<'sim' | 'admin'>('sim');
  const [catalog, setCatalog] = useState<Product[]>([]);

  useEffect(() => {
    api
      .config()
      .then(async (cfg) => {
        setConfig(cfg);
        if (!cfg.authRequired) return setAuthed(true);
        try {
          await api.config('1');
          setAuthed(true);
        } catch {
          setAuthed(false);
        }
      })
      .catch((e) => setConfigError(e instanceof Error ? e.message : 'Serveur injoignable'));
  }, []);

  useEffect(() => {
    if (authed) api.catalog().then(setCatalog).catch(() => setCatalog([]));
  }, [authed]);

  if (configError) return <Shell><p className="error card narrow">Serveur injoignable : {configError}</p></Shell>;
  if (!config) return <Shell><p className="muted center">Chargement…</p></Shell>;
  if (!authed) return <Shell><Login onOk={() => setAuthed(true)} /></Shell>;

  return (
    <Shell
      nav={
        <nav className="tabs">
          <button className={tab === 'sim' ? 'active' : ''} onClick={() => setTab('sim')}>Simulateur</button>
          <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>Catalogue</button>
        </nav>
      }
    >
      {tab === 'sim' ? (
        <Simulator config={config} catalog={catalog} goAdmin={() => setTab('admin')} />
      ) : (
        <Admin catalog={catalog} onCatalog={setCatalog} storage={config.storage} />
      )}
    </Shell>
  );
}

function Shell({ children, nav }: { children: React.ReactNode; nav?: React.ReactNode }) {
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>◧</span>
          <div>
            <h1>Simulateur de déco</h1>
            <p>Votre bureau, décoré sans toucher à l’existant</p>
          </div>
        </div>
        {nav}
      </header>
      <main>{children}</main>
    </div>
  );
}

function Login({ onOk }: { onOk: () => void }) {
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  return (
    <section className="card narrow">
      <h2>Accès équipe</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setAppPassword(pwd);
          try {
            await api.config('1');
            onOk();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Erreur');
          }
        }}
      >
        <input type="password" placeholder="Mot de passe" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
        <button className="primary">Entrer</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Simulator({ config, catalog, goAdmin }: { config: AppConfig; catalog: Product[]; goAdmin: () => void }) {
  const [source, setSource] = useState<PreparedSource | null>(null);
  const [uploadError, setUploadError] = useState('');
  const mask = useRef<HTMLCanvasElement | null>(null);
  const [maskVersion, setMaskVersion] = useState(0);
  const [protect, setProtect] = useState(true);
  const [criteria, setCriteria] = useState<Criteria>(emptyCriteria);
  const [inspirations, setInspirations] = useState<{ dataUrl: string; inline: InlineImage }[]>([]);
  const [engine, setEngine] = useState<EngineId | null>(config.defaultEngine);
  const [with360, setWith360] = useState(false);
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | 'edit' | 'panorama' | 'compose'>('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Generation[]>([]);
  const [current, setCurrent] = useState<Generation | null>(null);
  const abort = useRef<AbortController | null>(null);

  const products = useMemo(() => pickProducts(criteria, catalog), [criteria, catalog]);
  const activeCount = CATEGORIES.filter((c) => criteria.categories[c.id].on).length;
  const autoPrompt = useMemo(
    () => buildPrompt(criteria, products, inspirations.length),
    [criteria, products, inspirations.length],
  );
  const prompt = promptOverride ?? autoPrompt;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hasMask = useMemo(() => (mask.current ? maskHasPaint(mask.current) : false), [maskVersion, source]);

  const onFile = async (file?: File) => {
    if (!file) return;
    setUploadError('');
    try {
      const prepared = await prepareSource(file);
      const m = document.createElement('canvas');
      m.width = prepared.width;
      m.height = prepared.height;
      mask.current = m;
      setSource(prepared);
      setHistory([]);
      setCurrent(null);
      setMaskVersion((v) => v + 1);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Image illisible');
    }
  };

  const toggleCategory = (id: CategoryId) =>
    setCriteria((c) => ({ ...c, categories: { ...c.categories, [id]: { ...c.categories[id], on: !c.categories[id].on } } }));
  const setChoice = (id: CategoryId, patch: Partial<Criteria['categories'][CategoryId]>) =>
    setCriteria((c) => ({ ...c, categories: { ...c.categories, [id]: { ...c.categories[id], ...patch } } }));

  const addInspirations = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_INSPIRATIONS - inspirations.length;
    const list = await Promise.all(Array.from(files).slice(0, room).map((f) => compressImage(f)));
    setInspirations((x) => [...x, ...list]);
  };

  const canGenerate = Boolean(source && engine && (activeCount > 0 || criteria.extra.trim() || inspirations.length));

  const generate = async () => {
    if (!source || !engine) return;
    setError('');
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const productRefs = products.filter((p) => p.imageUrl).map((p) => ({ name: p.name, imageUrl: p.imageUrl! }));
    // Cloudflare n'accepte que des images d'entrée < 512 px : on les réduit avant envoi.
    const small = engine === 'cloudflare';
    const fit = (dataUrl: string, inline: InlineImage) => (small ? downscaleInline(dataUrl, 504) : Promise.resolve(inline));
    try {
      setStatus('edit');
      const res = await api.generate(
        {
          engine,
          mode: 'edit',
          prompt,
          aspect: source.aspect,
          width: source.width,
          height: source.height,
          source: await fit(source.dataUrl, source.inline),
          inspirations: await Promise.all(inspirations.map((i) => fit(i.dataUrl, i.inline))),
          productRefs,
        },
        signal,
      );
      setStatus('compose');
      const canvas = await compositeProtected(source.canvas, res.image, protect ? mask.current : null);
      const gen: Generation = {
        id: crypto.randomUUID(),
        canvas,
        url: canvas.toDataURL('image/jpeg', 0.92),
        products,
        engine: res.engine,
        model: res.model,
        at: new Date(),
      };
      setCurrent(gen);
      setHistory((h) => [gen, ...h].slice(0, 12));

      if (with360) {
        setStatus('panorama');
        const pano = await api.generate(
          {
            engine,
            mode: 'panorama',
            prompt: buildPanoramaPrompt(prompt),
            aspect: '21:9',
            width: small ? 1024 : 2048,
            height: small ? 512 : 1024,
            source: await fit(gen.url, dataUrlToInline(gen.url)),
            inspirations: [],
            productRefs: [],
          },
          signal,
        );
        const url = inlineToDataUrl(pano.image);
        const img = await loadImage(url);
        const withPano = { ...gen, panorama: { url, width: img.naturalWidth, height: img.naturalHeight, inline: pano.image } };
        setCurrent(withPano);
        setHistory((h) => h.map((x) => (x.id === gen.id ? withPano : x)));
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') setError('Génération annulée.');
      else setError(e instanceof Error ? e.message : 'Erreur de génération');
    } finally {
      setStatus('');
      abort.current = null;
    }
  };

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  const downloadPanorama = async (g: Generation) => {
    if (!g.panorama) return;
    const img = await loadImage(g.panorama.url);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    downloadCanvas(c, `bureau-deco-360-${stamp()}.png`);
  };

  const noEngine = config.engines.length === 0;

  return (
    <div className="sim">
      <div className="steps">
        {/* 1. Photo */}
        <section className="card">
          <StepTitle n={1} title="Photo du bureau sans déco" done={Boolean(source)} />
          <label
            className={`dropzone ${source ? 'compact' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
          >
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
            {source ? (
              <span>Changer de photo</span>
            ) : (
              <>
                <strong>Dépose ta photo ici</strong>
                <span className="muted">ou clique pour choisir — JPG, PNG ou WebP</span>
              </>
            )}
          </label>
          {uploadError && <p className="error">{uploadError}</p>}
          {source && source.cropped > 0.01 && (
            <p className="muted small">
              Photo recadrée au format {source.aspect} ({Math.round(source.cropped * 100)} % des bords retirés) pour que le rendu se superpose exactement.
            </p>
          )}
        </section>

        {/* 2. Zones protégées */}
        {source && mask.current && (
          <section className="card">
            <StepTitle n={2} title="Zones à garder intactes" done={hasMask} />
            <p className="muted">
              Peins sur la table, les écrans et la chaise. Ces zones reprennent les pixels de ta photo après la génération : formes et couleurs 100 % identiques.
            </p>
            <MaskEditor source={source} mask={mask.current} onChange={() => setMaskVersion((v) => v + 1)} />
            <label className="check">
              <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
              Recoller les zones protégées sur le résultat
            </label>
          </section>
        )}

        {/* 3. Critères */}
        {source && (
          <section className="card">
            <StepTitle n={3} title="Catégories et critères" done={activeCount > 0} />
            <div className="cat-grid">
              {CATEGORIES.map((c) => (
                <button key={c.id} className={`cat ${criteria.categories[c.id].on ? 'on' : ''}`} onClick={() => toggleCategory(c.id)}>
                  <strong>{c.label}</strong>
                  <span>{c.hint}</span>
                </button>
              ))}
            </div>

            {activeCount > 0 && (
              <div className="cat-details">
                {CATEGORIES.filter((c) => criteria.categories[c.id].on).map((c) => {
                  const choice = criteria.categories[c.id];
                  const inCat = catalog.filter((p) => p.category === c.id);
                  return (
                    <div key={c.id} className="cat-row">
                      <span className="cat-name">{c.label}</span>
                      <input
                        placeholder="Précision : ex. 2 cadres noirs"
                        value={choice.detail}
                        onChange={(e) => setChoice(c.id, { detail: e.target.value })}
                        maxLength={200}
                      />
                      <select value={choice.productId} onChange={(e) => setChoice(c.id, { productId: e.target.value })}>
                        <option value="auto">Pièce du catalogue : auto</option>
                        <option value="none">Aucune pièce du catalogue</option>
                        {inCat.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.brand} — {euro(p.price)}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
                {catalog.length === 0 && (
                  <p className="warning">
                    Le catalogue est vide : la légende ne pourra lister aucune pièce.{' '}
                    <button className="link" onClick={goAdmin}>Ajouter des produits</button>
                  </p>
                )}
              </div>
            )}

            <div className="criteria">
              <label>
                Style
                <select value={criteria.style} onChange={(e) => setCriteria((c) => ({ ...c, style: e.target.value }))}>
                  {STYLES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label>
                Palette de couleurs
                <input
                  placeholder="ex. vert sauge, bois clair, laiton"
                  value={criteria.palette}
                  onChange={(e) => setCriteria((c) => ({ ...c, palette: e.target.value }))}
                />
              </label>
              <label>
                Budget max (€)
                <input
                  type="number"
                  min={0}
                  placeholder="Sans limite"
                  value={criteria.budget ?? ''}
                  onChange={(e) => setCriteria((c) => ({ ...c, budget: e.target.value === '' ? null : Number(e.target.value) }))}
                />
              </label>
            </div>
          </section>
        )}

        {/* 4. Inspirations */}
        {source && (
          <section className="card">
            <StepTitle n={4} title="Inspirations (facultatif)" done={inspirations.length > 0 || Boolean(criteria.extra.trim())} />
            <div className="inspi">
              {inspirations.map((i, idx) => (
                <figure key={idx}>
                  <img src={i.dataUrl} alt={`Inspiration ${idx + 1}`} />
                  <button className="remove" aria-label="Retirer" onClick={() => setInspirations((x) => x.filter((_, j) => j !== idx))}>×</button>
                </figure>
              ))}
              {inspirations.length < MAX_INSPIRATIONS && (
                <label className="inspi-add">
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => void addInspirations(e.target.files)} />
                  + Image
                </label>
              )}
            </div>
            <textarea
              rows={3}
              placeholder="Décris l’ambiance voulue : ex. « coin cosy avec beaucoup de plantes, lumière chaude le soir, panneau acoustique vert derrière les écrans »"
              value={criteria.extra}
              onChange={(e) => setCriteria((c) => ({ ...c, extra: e.target.value }))}
              maxLength={1500}
            />
          </section>
        )}

        {/* 5. Génération */}
        {source && (
          <section className="card">
            <StepTitle n={5} title="Générer" done={Boolean(current)} />
            {noEngine ? (
              <p className="error">Aucun moteur configuré. Renseigne GEMINI_API_KEY ou POLLINATIONS_API_KEY (voir README).</p>
            ) : (
              <div className="gen-controls">
                <label>
                  Moteur
                  <select value={engine ?? ''} onChange={(e) => setEngine(e.target.value as EngineId)}>
                    {config.engines.map((e) => (
                      <option key={e.id} value={e.id}>{e.label} · {e.model}</option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={with360} onChange={(e) => setWith360(e.target.checked)} />
                  Vue 360° en plus (approximative : l’IA invente ce qui est hors photo)
                </label>
              </div>
            )}
            <details className="prompt-box">
              <summary>Voir / modifier le prompt envoyé à l’IA</summary>
              <textarea rows={12} value={prompt} onChange={(e) => setPromptOverride(e.target.value)} />
              {promptOverride !== null && (
                <button className="link" onClick={() => setPromptOverride(null)}>Revenir au prompt automatique</button>
              )}
            </details>
            <div className="row-end">
              {status && (
                <button className="ghost" onClick={() => abort.current?.abort()}>Annuler</button>
              )}
              <button className="primary big" disabled={!canGenerate || Boolean(status) || noEngine} onClick={() => void generate()}>
                {status === 'edit' && 'Décoration en cours…'}
                {status === 'compose' && 'Assemblage…'}
                {status === 'panorama' && 'Vue 360° en cours…'}
                {!status && (current ? 'Générer une variante' : 'Générer la simulation')}
              </button>
            </div>
            {!canGenerate && source && <p className="muted small">Choisis au moins une catégorie, une inspiration ou décris l’ambiance.</p>}
            {error && <p className="error">{error}</p>}
          </section>
        )}
      </div>

      {/* Résultat */}
      {current && source && (
        <section className="card result">
          <div className="row-between">
            <h2>Résultat</h2>
            <span className="muted small">
              {current.engine} · {current.model} · {current.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <Compare before={source.dataUrl} after={current.url} />
          <div className="row-end">
            <button className="ghost" onClick={() => downloadCanvas(current.canvas, `bureau-deco-${stamp()}.png`)}>Image seule</button>
            <button className="primary" onClick={() => downloadCanvas(withLegend(current.canvas, current.products), `bureau-deco-legende-${stamp()}.png`)}>
              Télécharger avec légende
            </button>
          </div>

          <h3>Où trouver les pièces en Île-de-France</h3>
          {current.products.length === 0 ? (
            <p className="muted">Aucune pièce du catalogue n’a été associée. Ajoute des produits dans l’onglet Catalogue ou choisis-les par catégorie.</p>
          ) : (
            <ol className="legend">
              {current.products.map((p) => (
                <li key={p.id}>
                  <div>
                    <strong>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.name}</a> : p.name}</strong>
                    <span className="muted"> · {categoryLabel(p.category)}</span>
                    <div className="muted small">
                      {p.brand} — {p.store}{p.city ? `, ${p.city}` : ''} · prix relevé le {new Date(p.priceCheckedAt).toLocaleDateString('fr-FR')}
                    </div>
                  </div>
                  <strong className="price">{euro(p.price)}</strong>
                </li>
              ))}
              <li className="total">
                <span>Total estimé</span>
                <strong>{euro(current.products.reduce((s, p) => s + p.price, 0))}</strong>
              </li>
            </ol>
          )}
          <p className="muted small">Visuel généré par IA : l’aspect peut différer des produits réels.</p>

          {current.panorama && (
            <>
              <div className="row-between">
                <h3>Vue 360°</h3>
                <button className="ghost" onClick={() => void downloadPanorama(current)}>Télécharger le panorama</button>
              </div>
              <Panorama src={current.panorama.url} width={current.panorama.width} height={current.panorama.height} />
              <p className="muted small">Approximation : seule la partie visible sur ta photo est réelle, le reste de la pièce est imaginé par l’IA.</p>
            </>
          )}

          {history.length > 1 && (
            <>
              <h3>Variantes</h3>
              <div className="history">
                {history.map((g) => (
                  <button key={g.id} className={g.id === current.id ? 'on' : ''} onClick={() => setCurrent(g)}>
                    <img src={g.url} alt="Variante" />
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function StepTitle({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <h2 className="step-title">
      <span className={`step-n ${done ? 'done' : ''}`}>{done ? '✓' : n}</span>
      {title}
    </h2>
  );
}
