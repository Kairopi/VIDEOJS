/**
 * Tint's own words, for Video.js's i18n registry. English is built into the markup; register these alongside a
 * shipped locale pack to translate them:
 *
 *   import fr from '@videojs/html/i18n/locales/fr';
 *   registerI18n('fr', fr);
 *   registerI18n('fr', tintTranslations.fr);
 */
interface TintWords {
  scene: string;
  scenes: string;
  scenesMenu: string;
  watching: string;
  wholeFilm: string;
  savePoster: string;
  pickFrame: string;
}

export const tintTranslations: Record<string, { tint: TintWords }> = {
  en: {
    tint: {
      scene: 'Scene',
      scenes: 'scenes',
      scenesMenu: 'Scenes',
      watching: "You're watching",
      wholeFilm: 'The whole film',
      savePoster: 'Save poster',
      pickFrame: 'Pick any frame to play from there',
    },
  },
  fr: {
    tint: {
      scene: 'Scène',
      scenes: 'scènes',
      scenesMenu: 'Scènes',
      watching: 'Vous regardez',
      wholeFilm: 'Le film entier',
      savePoster: 'Enregistrer l’affiche',
      pickFrame: 'Choisissez une image pour reprendre là',
    },
  },
  es: {
    tint: {
      scene: 'Escena',
      scenes: 'escenas',
      scenesMenu: 'Escenas',
      watching: 'Estás viendo',
      wholeFilm: 'La película entera',
      savePoster: 'Guardar póster',
      pickFrame: 'Elige un fotograma para verlo desde ahí',
    },
  },
  de: {
    tint: {
      scene: 'Szene',
      scenes: 'Szenen',
      scenesMenu: 'Szenen',
      watching: 'Du siehst gerade',
      wholeFilm: 'Der ganze Film',
      savePoster: 'Poster speichern',
      pickFrame: 'Wähle ein Bild, um dort weiterzusehen',
    },
  },
  ja: {
    tint: {
      scene: 'シーン',
      scenes: 'シーン',
      scenesMenu: 'シーン',
      watching: '視聴中',
      wholeFilm: '映画全体',
      savePoster: 'ポスターを保存',
      pickFrame: 'フレームを選ぶとそこから再生します',
    },
  },
  ar: {
    tint: {
      scene: 'المشهد',
      scenes: 'مشاهد',
      scenesMenu: 'المشاهد',
      watching: 'أنت تشاهد',
      wholeFilm: 'الفيلم كاملاً',
      savePoster: 'حفظ الملصق',
      pickFrame: 'اختر لقطة لتشغيل الفيلم منها',
    },
  },
};
