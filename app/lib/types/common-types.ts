export type Reject = { message: string; status?: number };

export type NflState = {
  season: number;
  leg: number;
  week: number;
};

export type Allplayer = {
  player_id: string;
  position: string;
  team: string;
  full_name: string;
  first_name: string;
  last_name: string;
  age: number;
  fantasy_positions: string[];
  years_exp: number;
  active: boolean;
};

export type Column = {
  key: string;
  value: string;
  setText: (text: string) => void;
};

export type OptimalPlayer = {
  index: number;
  slot__index: string;
  optimal_player_id: string;
  player_position: string;
  value: number;
  playing?: boolean;
  result?: "W" | "L" | "T";
  is_in_progress?: boolean;
};
