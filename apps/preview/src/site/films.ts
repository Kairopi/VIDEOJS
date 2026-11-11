/** The films on the site, streamed from Mux by public playback ID. All by Blender Studio, CC BY 4.0. */
export interface Film {
  id: string;
  title: string;
  year: number;
  /** One line: what the film's colour story looks like. */
  line: string;
  genre: string;
  /** What the film is about, in one sentence, for the poster (our words, from Blender Studio's synopsis). */
  logline: string;
}

export const FILMS: Film[] = [
  {
    id: 'U3LiBMyOo4VN5Wo7tizr29nBMpI8ihbIdG4v1500eq5E',
    title: 'Sprite Fright',
    year: 2021,
    line: 'Golden forest, blue night, pink dawn.',
    genre: 'Comedy horror',
    logline: 'Rowdy teenagers camp in a quiet forest and meet its mushroom sprites, who are not as harmless as they look.',
  },
  {
    id: 'FyFqDt6xAEhuQtIUeVq016eeoi2G55kFqfR02gpvS01Qf8',
    title: 'Spring',
    year: 2019,
    line: 'Frost blue, ember orange, mountain gold.',
    genre: 'Fantasy',
    logline: 'Winter will not let go of the valley, so a shepherd girl and her dog climb to face the ancient spirits of the mountain.',
  },
  {
    id: 'PV2RcCIMOqW01eQKarkLWowkz2PuNjdc4XvZdZvNsZCg',
    title: 'Coffee Run',
    year: 2020,
    line: 'Sand, violet, sky blue and café pink.',
    genre: 'Drama',
    logline: 'One cup of coffee, and a young woman runs back through the memories of a relationship that ended.',
  },
  {
    id: 'zmuJAB3MHhAyJV9E5OHD4Ci01GqD01gGxBRZnHdhqZK9M',
    title: 'Charge',
    year: 2022,
    line: 'Candlelight amber, steel teal, neon pink.',
    genre: 'Action',
    logline: 'In a world short of power, an old man breaks into a battery factory and finds a security droid between him and the way out.',
  },
];
