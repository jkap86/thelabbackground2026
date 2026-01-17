export type SleeperLeague = {
  league_id: string;
  previous_league_id: string | null;
  name: string;
  avatar: string | null;
  roster_positions: string[] | null;
  scoring_settings: { [key: string]: number } | null;
  settings: SleeperLeagueSettings;
  status: string;
  season: string;
};

export type SleeperLeagueSettings = {
  taxi_slots: number;
  reserve_slots: number;
  best_ball?: number;
  type: number;
  reserve_allow_na: number;
  reserve_allow_doubtful: number;
  league_average_match: number;
  draft_rounds: number;
  playoff_week_start: number;
  trade_deadline: number;
  disable_trades: number;
  daily_waivers: number;
};

export type SleeperUser = {
  user_id: string;
  display_name: string;
  avatar: string | null;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  taxi: string[] | null;
  reserve: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
  };
};

export type SleeperDraft = {
  draft_id: string;
  league_id: string;
  season: string;
  type: string;
  status: string;
  start_time: number | null;
  last_picked: number | null;
  draft_order: {
    [key: string]: number;
  };
  slot_to_roster_id?: {
    [key: string]: number;
  };
  settings: {
    rounds: number;
    slots_k: number;
    slots_qb?: number;
    slots_rb?: number;
    slots_wr?: number;
    slots_te?: number;
    slots_flex?: number;
    slots_def?: number;
    slots_bn?: number;
    pick_timer?: number;
    budget?: number;
    nomination_timer?: number;
  };
  created?: number;
};

export type SleeperDraftPick = {
  season: string;
  owner_id: number;
  roster_id: number;
  previous_owner_id: number;
  round: number;
};

export type SleeperDraftDraftPick = {
  draft_id: string;
  player_id: string;
  picked_by: string;
  roster_id: number;
  round: number;
  draft_slot: number;
  pick_no: number;
  amount?: number;
  is_keeper: boolean | null;
  metadata: {
    first_name: string;
    last_name: string;
    position: string;
    team?: string;
    status?: string;
  };
};

export type SleeperTransaction = {
  transaction_id: string;
  status_updated: number;
  type: string;
  status: string;
  adds: { [player_id: string]: number };
  drops: { [player_id: string]: number };
  draft_picks: {
    round: number;
    season: string;
    roster_id: number;
    owner_id: number;
    previous_owner_id: number;
  }[];
};
