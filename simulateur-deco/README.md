# Simulateur de déco de bureau

Web app interne : on charge une photo du bureau sans déco, on protège ce qui ne doit pas bouger, on choisit les catégories de déco. L'IA génère le bureau décoré, avec une légende « où trouver les pièces en Île-de-France » (prix et magasin) tirée de votre catalogue.

## Fonctionnalités

| Besoin | Comment c'est fait |
| --- | --- |
| Garder table, écrans, chaise, formes et couleurs | Consigne stricte au modèle **+** recollage des pixels d'origine sur les zones peintes en rouge (étape 2). Sur ces zones, le résultat est identique à 100 % à la photo. |
| Catégories au choix | Rangement, accessoires, déco murale, panneau mural, lumières, tapis, plantes, rideaux, textiles, mobilier d'appoint. Précision libre et pièce du catalogue par catégorie. |
| Critères | Style, palette, budget max (le choix auto des pièces respecte le budget). |
| Inspirations + prompt | Jusqu'à 3 images d'inspiration et une description libre. Le prompt complet reste visible et modifiable. |
| Vue 360° (option) | Panorama généré à partir du rendu, affiché dans une visionneuse 360°. **Approximatif** : la partie hors photo est inventée par l'IA. |
| Téléchargement | PNG « image seule » ou « avec légende » (pièces, enseigne, magasin, prix, date du relevé, total). |
| Catalogue | Onglet *Catalogue* protégé par mot de passe admin : ajout, modification, suppression, import et export JSON. |
| Moteur interchangeable | Gemini (Nano Banana) ou Pollinations, au choix dans l'app selon les clés renseignées. |

> La photo est recadrée au ratio supporté le plus proche (bords légèrement rognés si besoin). La sortie IA se superpose ainsi exactement à l'original.

## Déployer sur Vercel (gratuit)

1. **Code** : pousse ce dossier sur un dépôt GitHub (privé).
2. **Vercel** : crée un compte sur vercel.com, puis *Add New → Project* et importe le dépôt. Le framework Vite est détecté tout seul.
3. **Stockage du catalogue** : dans le projet Vercel, *Storage → Create → Upstash for Redis* (offre gratuite), puis connecte la base au projet. Vercel crée `KV_REST_API_URL` et `KV_REST_API_TOKEN`.
4. **Variables d'environnement** : dans *Settings → Environment Variables*, ajoute les variables de `.env.example` :
   - `APP_PASSWORD` et `ADMIN_PASSWORD` (obligatoires)
   - au moins une clé moteur : `GEMINI_API_KEY` ou `POLLINATIONS_API_KEY`
   - `DEFAULT_ENGINE` = `gemini` ou `pollinations`
5. **Redéploie** (*Deployments → Redeploy*). Partage l'URL et le mot de passe avec l'équipe.

### Clés des moteurs

- **Cloudflare Workers AI (gratuit, recommandé pour démarrer)** : crée un compte gratuit sur dash.cloudflare.com, puis va dans *AI → Workers AI → Use REST API*. Copie l'**Account ID** (`CLOUDFLARE_ACCOUNT_ID`) et crée un **Workers AI API Token** (`CLOUDFLARE_API_TOKEN`). Ce moteur offre 10 000 neurones par jour, environ 80 à 90 simulations par jour avec `flux-2-klein-4b`. Limite : les images d'entrée sont réduites à moins de 512 px, donc les détails sont moins fins, mais les zones protégées gardent la photo d'origine en pleine résolution. Les photos produit du catalogue ne sont pas transmises : seule leur description passe au modèle.

- **Gemini** : clé sur https://aistudio.google.com/apikey. Pas d'offre gratuite pour la génération d'images via l'API : active la facturation (Google offre 300 $ de crédit aux nouveaux comptes Cloud). Compte environ 0,04 $ par image. Modèle par défaut : `gemini-3.1-flash-image`. Pour essayer Nano Banana 2.1, mets `GEMINI_MODEL=gemini-nano-banana-2.1`.
- **Pollinations** : clé secrète `sk_…` sur https://enter.pollinations.ai. Démarrage gratuit avec les crédits « quêtes », puis Pollen payant. Modèle par défaut : `google/gemini-2.5-flash-image` (accepte plusieurs images). Alternatives : `bytedance/seedream-4.0`, `black-forest-labs/flux.2-klein-4b`.

## Tester en local

```bash
npm install
cp .env.example .env.local   # puis renseigne les valeurs
npm run dev                  # http://localhost:5173
```

`MOCK_ENGINE=1` ajoute un moteur factice, sans appel IA ni coût, pour tester l'interface.

## Bonnes pratiques d'usage

- **Photo** : prise en plein jour, de face, nette. Plus la photo est propre, meilleur est le rendu.
- **Zones protégées** : peins large sur la table, les écrans et la chaise. Évite de peindre là où tu veux de la déco (un mur au-dessus des écrans, par exemple).
- **Catalogue** : renseigne une *URL de photo produit* (https). L'IA s'en sert comme référence et le rendu se rapproche du vrai produit. Mets à jour les prix : la date du relevé est affichée dans la légende.
- **Confidentialité** : la photo est envoyée au fournisseur IA choisi. Évite tout document ou écran affichant des informations sensibles.

## Structure

```
api/              Fonctions serveur Vercel (clés API jamais exposées au navigateur)
  _lib/engines.ts Moteurs Gemini / Pollinations / factice
  _lib/store.ts   Catalogue (Upstash Redis, mémoire en local)
src/              Interface React
  lib/image.ts    Recadrage, recollage des zones protégées, légende, téléchargement
  lib/prompt.ts   Construction du prompt et choix automatique des pièces
shared/           Types et catégories communs
```
