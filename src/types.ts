export interface Puzzle {
  puzzleid: string;
  fen: string;
  moves: string[];
  rating: number;
  ratingdeviation: number;
  popularity: number;
  themes: string[];
  "opening tags": string[];
  cost: number;
}

export interface PuzzleResponse {
  puzzles: Puzzle[];
}

export interface PuzzleRow {
  puzzle_id: string;
  fen: string;
  moves_json: string | string[];
  rating: number;
  rating_deviation: number;
  popularity: number;
  nb_plays: number;
  game_url: string;
  player_moves: number;
  theme_names: string[] | null;
  opening_names: string[] | null;
}

export interface AuthConfig {
  apiKey: string;
  description?: string;
  createdAt?: Date;
  isActive?: boolean;
}
