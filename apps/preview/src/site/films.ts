/** The films on the site. Each one streams from Mux by its public playback ID. */
export interface Film {
  id: string;
  title: string;
  year: number;
  /** One line: what the film's colour story looks like. */
  line: string;
  credit: string;
}

export const FILMS: Film[] = [
  {
    id: 'VZtzUzGRv02OhRnZCxcNg49OilvolTqdnFLEqBsTwaxU',
    title: 'Sprite Fright',
    year: 2021,
    line: 'Golden forest, blue night, pink dawn.',
    credit: 'Blender Studio',
  },
];

export const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';
