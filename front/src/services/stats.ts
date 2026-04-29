import { request } from "./auth";

export type PersonalStats = {
  games_played: number;
  wins: number;
  win_rate: number;
  correct_answers: number;
  total_answers: number;
  accuracy: number;
  best_score: number;
  avg_response_time_ms: number | null;
  playtime: number;
};

export type LeaderboardEntry = {
  username: string;
  value: number;
};

export type LeaderboardResponse = {
  top_wins: LeaderboardEntry[];
  top_playtime: LeaderboardEntry[];
  fastest_players: LeaderboardEntry[];
};

export const fetchStats = async (): Promise<PersonalStats> =>
  request<PersonalStats>("/stats/me");

export const fetchLeaderboard = async (): Promise<LeaderboardResponse> =>
  request<LeaderboardResponse>("/stats/leaderboard");
