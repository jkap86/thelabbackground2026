export type KtcPlayerDbUpdate = {
  player_id: string;
  date: string;
  value: number;
  overall_rank: number;
  position_rank: number;
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
