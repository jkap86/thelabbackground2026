import { OptimalPlayer } from "./common-types";

export type Score = {
  [roster_id: string]: {
    optimal_starters: OptimalPlayer[];
    optimal_bench: OptimalPlayer[];
    points: number;
  };
};
