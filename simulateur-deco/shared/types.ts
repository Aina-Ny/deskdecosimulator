export type EngineId = 'gemini' | 'pollinations' | 'mock';

export interface InlineImage {
  mime: string;
  /** base64 sans préfixe data: */
  data: string;
}

export interface Product {
  id: string;
  name: string;
  category: CategoryId;
  /** Enseigne : IKEA, Maisons du Monde, Leroy Merlin… */
  brand: string;
  /** Magasin physique en Île-de-France : nom + adresse */
  store: string;
  city: string;
  price: number;
  url?: string;
  imageUrl?: string;
  styles: string[];
  /** Description courte, en clair, utilisée dans le prompt IA */
  description?: string;
  /** Date (ISO) à laquelle le prix a été relevé */
  priceCheckedAt: string;
}

export type CategoryId =
  | 'rangement'
  | 'accessoires'
  | 'deco-murale'
  | 'panneau-mural'
  | 'lumieres'
  | 'tapis'
  | 'plantes'
  | 'rideaux'
  | 'textiles'
  | 'mobilier-appoint';

export interface GenerateRequest {
  engine: EngineId;
  mode: 'edit' | 'panorama';
  prompt: string;
  /** Ratio "w:h" parmi les ratios supportés */
  aspect: string;
  width: number;
  height: number;
  source: InlineImage;
  inspirations: InlineImage[];
  /** Produits du catalogue dont l'image sert de référence visuelle */
  productRefs: { name: string; imageUrl: string }[];
}

export interface GenerateResponse {
  image: InlineImage;
  engine: EngineId;
  model: string;
  /** Nombre d'images produit réellement transmises */
  productRefsUsed: number;
}

export interface AppConfig {
  authRequired: boolean;
  engines: { id: EngineId; label: string; model: string }[];
  defaultEngine: EngineId | null;
  storage: 'redis' | 'memory';
}
