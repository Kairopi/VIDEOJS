/**
 * Tint's own words, for Video.js's i18n registry. English is built into the markup; register these alongside a
 * shipped locale pack to translate them:
 *
 *   import fr from '@videojs/html/i18n/locales/fr';
 *   registerI18n('fr', fr);
 *   registerI18n('fr', tintTranslations.fr);
 */
export const tintTranslations: Record<string, { tint: { scene: string; scenes: string; scenesMenu: string } }> = {
  en: { tint: { scene: 'Scene', scenes: 'scenes', scenesMenu: 'Scenes' } },
  fr: { tint: { scene: 'Scène', scenes: 'scènes', scenesMenu: 'Scènes' } },
  es: { tint: { scene: 'Escena', scenes: 'escenas', scenesMenu: 'Escenas' } },
  de: { tint: { scene: 'Szene', scenes: 'Szenen', scenesMenu: 'Szenen' } },
  ja: { tint: { scene: 'シーン', scenes: 'シーン', scenesMenu: 'シーン' } },
  ar: { tint: { scene: 'المشهد', scenes: 'مشاهد', scenesMenu: 'المشاهد' } },
};
