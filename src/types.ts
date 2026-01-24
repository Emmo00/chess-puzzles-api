export interface Puzzle {
  puzzleid: string;
  fen: string;
  moves: string[];
  rating: number;
  ratingdeviation: number;
  popularity: number;
  themes: string[];
  "opening tags": string[];
}

export interface PuzzleResponse {
  puzzles: Puzzle[];
}

export interface PuzzleRow {
  puzzle_id: string;
  fen: string;
  moves: string;
  rating: number;
  rating_deviation: number;
  popularity: number;
  nb_plays: number;
  themes: string;
  game_url: string;
  opening_tags: string;
  player_moves: number;
}

export interface AuthConfig {
  apiKey: string;
  description?: string;
  createdAt?: Date;
  isActive?: boolean;
}
