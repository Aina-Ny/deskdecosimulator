import type { CategoryId } from './types.js';

export interface Category {
  id: CategoryId;
  label: string;
  /** Formulation anglaise pour le prompt IA */
  prompt: string;
  hint: string;
}

export const CATEGORIES: Category[] = [
  { id: 'rangement', label: 'Rangement', prompt: 'storage (shelves, cabinets, boxes, organizers)', hint: 'Étagères, caissons, boîtes…' },
  { id: 'accessoires', label: 'Accessoires de bureau', prompt: 'desk accessories (pen holder, tray, monitor-friendly desk items) placed on free space only', hint: 'Pot à crayons, organiseur, sous-main…' },
  { id: 'deco-murale', label: 'Décoration murale', prompt: 'wall decoration (framed posters, art prints, mirror, wall shelf decor)', hint: 'Cadres, affiches, miroir…' },
  { id: 'panneau-mural', label: 'Panneau mural', prompt: 'wall panels (acoustic panels, wood slat panels, felt panels)', hint: 'Acoustique, tasseaux, feutre…' },
  { id: 'lumieres', label: 'Lumières', prompt: 'lighting (desk lamp, floor lamp, LED strip, pendant light)', hint: 'Lampe, lampadaire, ruban LED…' },
  { id: 'tapis', label: 'Tapis', prompt: 'a rug on the floor around/under the desk area without hiding the chair base', hint: 'Sous le bureau ou à côté' },
  { id: 'plantes', label: 'Plantes', prompt: 'indoor plants in pots', hint: 'Plantes vertes, suspensions…' },
  { id: 'rideaux', label: 'Rideaux & stores', prompt: 'curtains or blinds on existing windows', hint: 'Si une fenêtre est visible' },
  { id: 'textiles', label: 'Textiles', prompt: 'textiles (cushions, throw blanket) on existing seating only', hint: 'Coussins, plaid…' },
  { id: 'mobilier-appoint', label: "Mobilier d'appoint", prompt: 'small side furniture (side table, pouf, small cabinet) in empty floor space', hint: "Desserte, pouf, petite table…" },
];

export const STYLES = [
  'Scandinave',
  'Japandi',
  'Industriel',
  'Moderne minimaliste',
  'Bohème',
  'Chaleureux bois',
  'Contemporain chic',
  'Vintage',
];

export const STYLE_PROMPT: Record<string, string> = {
  Scandinave: 'Scandinavian (light wood, white, soft neutrals)',
  Japandi: 'Japandi (natural wood, beige, minimal, calm)',
  Industriel: 'industrial (black metal, dark wood, raw textures)',
  'Moderne minimaliste': 'modern minimalist (clean lines, few objects)',
  Bohème: 'bohemian (rattan, macrame, warm patterns)',
  'Chaleureux bois': 'warm wood and cozy textures',
  'Contemporain chic': 'contemporary chic (brass accents, velvet, refined)',
  Vintage: 'vintage mid-century',
};

export const categoryLabel = (id: CategoryId) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
