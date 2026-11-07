import { CATEGORIES, STYLE_PROMPT } from '../../shared/categories';
import type { CategoryId, Product } from '../../shared/types';

export interface CategoryChoice {
  on: boolean;
  /** Précision libre de l'utilisateur ("2 cadres noirs au-dessus des écrans") */
  detail: string;
  /** 'auto' = choix automatique dans le catalogue, 'none' = aucun produit, sinon id */
  productId: 'auto' | 'none' | string;
}

export interface Criteria {
  categories: Record<CategoryId, CategoryChoice>;
  style: string;
  palette: string;
  budget: number | null;
  /** Prompt libre (inspiration) */
  extra: string;
}

export const emptyCriteria = (): Criteria => ({
  categories: Object.fromEntries(
    CATEGORIES.map((c) => [c.id, { on: false, detail: '', productId: 'auto' }]),
  ) as Record<CategoryId, CategoryChoice>,
  style: 'Scandinave',
  palette: '',
  budget: null,
  extra: '',
});

/** Choisit un produit par catégorie active : sélection manuelle, sinon meilleur score style puis prix, dans le budget. */
export function pickProducts(criteria: Criteria, catalog: Product[]): Product[] {
  const active = CATEGORIES.filter((c) => criteria.categories[c.id].on);
  const picked: Product[] = [];
  let remaining = criteria.budget ?? Infinity;

  // 1. Sélections manuelles d'abord
  for (const c of active) {
    const choice = criteria.categories[c.id];
    if (choice.productId === 'auto' || choice.productId === 'none') continue;
    const p = catalog.find((x) => x.id === choice.productId);
    if (p) {
      picked.push(p);
      remaining -= p.price;
    }
  }
  // 2. Auto, en respectant le budget restant
  const style = criteria.style.toLowerCase();
  for (const c of active) {
    if (criteria.categories[c.id].productId !== 'auto') continue;
    const candidates = catalog
      .filter((p) => p.category === c.id && p.price <= remaining)
      .sort((a, b) => {
        const sa = a.styles.some((s) => s.toLowerCase() === style) ? 1 : 0;
        const sb = b.styles.some((s) => s.toLowerCase() === style) ? 1 : 0;
        return sb - sa || a.price - b.price;
      });
    if (candidates[0]) {
      picked.push(candidates[0]);
      remaining -= candidates[0].price;
    }
  }
  // Ordre d'affichage : celui des catégories
  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  return picked.sort((a, b) => order.get(a.category)! - order.get(b.category)!);
}

const PRESERVE = `STRICT RULES — this is a real office photo (image 1) that must stay recognizable:
- Do NOT move, resize, recolor, restyle, replace or remove the desk/table, the monitors/screens, the chair or any existing furniture.
- Keep the exact same camera angle, perspective, framing, wall and floor colors, windows, doors and lighting direction.
- Only ADD decoration items in free space (walls, floor, shelves, empty desk areas). Never cover the screens or the chair.
- Photorealistic result, consistent shadows and scale. No text, no labels, no watermark.`;

export function buildPrompt(criteria: Criteria, products: Product[], inspirationCount: number): string {
  const lines = [
    'Edit image 1: decorate this office while preserving it exactly.',
    PRESERVE,
    '',
    `STYLE: ${STYLE_PROMPT[criteria.style] ?? criteria.style}.`,
  ];
  if (criteria.palette.trim()) lines.push(`COLOR PALETTE for the added items: ${criteria.palette.trim()}.`);
  lines.push('', 'ADD THE FOLLOWING:');
  for (const c of CATEGORIES) {
    const choice = criteria.categories[c.id];
    if (!choice.on) continue;
    const prod = products.find((p) => p.category === c.id);
    let item = `- ${c.prompt}`;
    if (prod) item += `; use this exact product: "${prod.name}" (${prod.brand})${prod.description ? ` — ${prod.description}` : ''}`;
    if (choice.detail.trim()) item += `; user request: ${choice.detail.trim()}`;
    lines.push(item);
  }
  if (inspirationCount > 0) lines.push('', 'Use the inspiration images only for mood, colors and materials.');
  if (criteria.extra.trim()) lines.push('', `ADDITIONAL REQUEST FROM THE USER: ${criteria.extra.trim()}`);
  return lines.join('\n');
}

export function buildPanoramaPrompt(basePrompt: string): string {
  return `Create a single 360-degree equirectangular panorama (full sphere, seamless left and right edges) of the SAME office as image 1, decorated as described below.
The view of image 1 must appear at the center of the panorama with its desk, monitors and chair unchanged. Extend the rest of the room plausibly and coherently with the same walls, floor and lighting.

${basePrompt}`;
}
