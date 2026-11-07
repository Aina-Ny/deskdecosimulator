import { useRef, useState } from 'react';
import { CATEGORIES, STYLES, categoryLabel } from '../../shared/categories';
import type { CategoryId, Product } from '../../shared/types';
import { api, ApiError, hasAdminPassword, setAdminPassword } from '../lib/api';

const blank = (): Partial<Product> => ({
  name: '',
  category: 'rangement',
  brand: '',
  store: '',
  city: '',
  price: undefined,
  url: '',
  imageUrl: '',
  styles: [],
  description: '',
});

const euro = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

interface Props {
  catalog: Product[];
  onCatalog: (p: Product[]) => void;
  storage: 'redis' | 'memory';
}

export function Admin({ catalog, onCatalog, storage }: Props) {
  const [unlocked, setUnlocked] = useState(hasAdminPassword());
  const [pwd, setPwd] = useState('');
  const [form, setForm] = useState<Partial<Product>>(blank());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<CategoryId | 'all'>('all');
  const fileRef = useRef<HTMLInputElement>(null);

  const guard = async (fn: () => Promise<Product[]>) => {
    setBusy(true);
    setError('');
    try {
      onCatalog(await fn());
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUnlocked(false);
      setError(e instanceof Error ? e.message : 'Erreur');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!unlocked) {
    return (
      <section className="card narrow">
        <h2>Admin du catalogue</h2>
        <p className="muted">Réservé à la personne qui tient le catalogue à jour.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setAdminPassword(pwd);
            try {
              await api.config('admin');
              setUnlocked(true);
              setError('');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Erreur');
            }
          }}
        >
          <input type="password" placeholder="Mot de passe admin" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
          <button className="primary">Déverrouiller</button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  const set = <K extends keyof Product>(k: K, v: Product[K] | undefined) => setForm((f) => ({ ...f, [k]: v }));
  const toggleStyle = (s: string) =>
    set('styles', form.styles?.includes(s) ? form.styles.filter((x) => x !== s) : [...(form.styles ?? []), s]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const done = await guard(() => (form.id ? api.updateProduct(form) : api.addProduct(form)));
    if (done) setForm(blank());
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `catalogue-deco-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const importJson = async (file: File) => {
    try {
      const list = JSON.parse(await file.text());
      if (!Array.isArray(list)) throw new Error('Le fichier doit contenir une liste de produits.');
      await guard(() => api.importProducts(list));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import impossible');
    }
  };

  const shown = catalog.filter((p) => filter === 'all' || p.category === filter);

  return (
    <div className="admin">
      {storage === 'memory' && (
        <p className="warning">
          Stockage non configuré : le catalogue est gardé en mémoire et sera perdu au redémarrage. Connecte Upstash Redis (voir README).
        </p>
      )}
      <section className="card">
        <h2>{form.id ? 'Modifier le produit' : 'Ajouter un produit'}</h2>
        <form className="grid-form" onSubmit={submit}>
          <label>
            Nom*
            <input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} required maxLength={120} />
          </label>
          <label>
            Catégorie*
            <select value={form.category} onChange={(e) => set('category', e.target.value as CategoryId)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label>
            Enseigne*
            <input value={form.brand ?? ''} onChange={(e) => set('brand', e.target.value)} placeholder="IKEA, Maisons du Monde…" required />
          </label>
          <label>
            Prix (€)*
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.price ?? ''}
              onChange={(e) => set('price', e.target.value === '' ? undefined : Number(e.target.value))}
              required
            />
          </label>
          <label className="span2">
            Magasin en Île-de-France*
            <input value={form.store ?? ''} onChange={(e) => set('store', e.target.value)} placeholder="IKEA Paris Madeleine, 23 bd de la Madeleine" required />
          </label>
          <label>
            Ville
            <input value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="Paris 1er" />
          </label>
          <label>
            Lien produit
            <input type="url" value={form.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://…" />
          </label>
          <label className="span2">
            URL de la photo produit (https, sert de référence à l’IA)
            <input type="url" value={form.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…/photo.jpg" />
          </label>
          <label className="span2">
            Description visuelle (aide l’IA à le dessiner)
            <input value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Étagère murale en chêne clair, 3 niveaux" maxLength={300} />
          </label>
          <fieldset className="span2">
            <legend>Styles</legend>
            <div className="chips">
              {STYLES.map((s) => (
                <button type="button" key={s} className={`chip ${form.styles?.includes(s) ? 'on' : ''}`} onClick={() => toggleStyle(s)}>
                  {s}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="span2 row-end">
            {form.id && (
              <button type="button" className="ghost" onClick={() => setForm(blank())}>Annuler</button>
            )}
            <button className="primary" disabled={busy}>{form.id ? 'Enregistrer' : 'Ajouter au catalogue'}</button>
          </div>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Catalogue ({catalog.length})</h2>
          <div className="row">
            <select value={filter} onChange={(e) => setFilter(e.target.value as CategoryId | 'all')}>
              <option value="all">Toutes catégories</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <button className="ghost" onClick={exportJson} disabled={!catalog.length}>Exporter JSON</button>
            <button className="ghost" onClick={() => fileRef.current?.click()}>Importer JSON</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && window.confirm('L’import remplace tout le catalogue actuel. Continuer ?')) void importJson(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="muted">Aucun produit. Ajoute les pièces réelles que l’équipe veut pouvoir proposer.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th>Magasin</th>
                  <th className="num">Prix</th>
                  <th>Relevé le</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.name}</a> : p.name}
                      <div className="muted small">{p.brand}</div>
                    </td>
                    <td>{categoryLabel(p.category)}</td>
                    <td>{p.store}{p.city ? `, ${p.city}` : ''}</td>
                    <td className="num">{euro(p.price)}</td>
                    <td>{new Date(p.priceCheckedAt).toLocaleDateString('fr-FR')}</td>
                    <td className="actions">
                      <button className="ghost small" onClick={() => setForm(p)}>Modifier</button>
                      <button
                        className="ghost small danger"
                        onClick={() => window.confirm(`Supprimer « ${p.name} » ?`) && void guard(() => api.deleteProduct(p.id))}
                        disabled={busy}
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">L’import remplace tout le catalogue. Exporte d’abord pour garder une sauvegarde.</p>
      </section>
    </div>
  );
}
