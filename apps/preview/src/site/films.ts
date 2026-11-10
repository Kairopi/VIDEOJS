/** The films on the site, streamed from Mux by public playback ID. All by Blender Studio, CC BY 4.0. */
export interface Film {
  id: string;
  title: string;
  year: number;
  /** One line: what the film's colour story looks like. */
  line: string;
}

export const FILMS: Film[] = [
  { id: 'U3LiBMyOo4VN5Wo7tizr29nBMpI8ihbIdG4v1500eq5E', title: 'Sprite Fright', year: 2021, line: 'Golden forest, blue night, pink dawn.' },
  { id: 'FyFqDt6xAEhuQtIUeVq016eeoi2G55kFqfR02gpvS01Qf8', title: 'Spring', year: 2019, line: 'Frost blue, ember orange, mountain gold.' },
  { id: 'PV2RcCIMOqW01eQKarkLWowkz2PuNjdc4XvZdZvNsZCg', title: 'Coffee Run', year: 2020, line: 'Sand, violet, sky blue and café pink.' },
  { id: 'zmuJAB3MHhAyJV9E5OHD4Ci01GqD01gGxBRZnHdhqZK9M', title: 'Charge', year: 2022, line: 'Candlelight amber, steel teal, neon pink.' },
];
