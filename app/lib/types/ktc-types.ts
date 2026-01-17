export type KtcPlayerDbUpdate = {
  player_id: string;
  date: string;
  value: number;
  overall_rank: number | null;
  position_rank: number | null;
};

export type ktcPlayerObj = {
  playerID: number;
  playerName: string;
  slug: string;
  position: string;
  team: string;
  superflexValues: {
    tepp: { value: number; rank: number; positionalRank: number };
  };
};
